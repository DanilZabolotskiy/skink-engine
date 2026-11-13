"""Hand sheets from the pose journal (tools/hands_check.mjs): 1:1 crops of all hands of all shots, necks from behind and sitting poses,
whole-arm sheets and neck sheets.

python tools/hands_sheet.py hands <chapter work folder> [--src check/arms] [--out check/hands] [--at 0.55]
python tools/hands_sheet.py arms <chapter work folder> [--src check/arms] [--out check/hands] [--at 0.55] [--all]
python tools/hands_sheet.py necks <chapter work folder> [--src check/arms] [--out check/hands] [--pair <src "before">] [--shots 02.01,…] [--who mira]
                                  [--cell 300]

The sheets need the frames of the pose journal: run tools/hands_check.mjs on the work folder first, without --no-png (the precheck step
runs it with --no-png into check/precheck/arms, which has the journal but no frames):
    cd "$(python tools/mirror.py)" && node tools/hands_check.mjs <absolute work folder> --out check/arms

hands — for every shot the frame nearest to fraction --at: a crop around every visible hand (centre — between the wrist and the fingertips,
side — 2.4 hand lengths, at least 150 px), 1:1; larger than a cell — scaled down (×k in the caption). Sheets hands_NN.jpg with 24 cells
and necks_sitting.jpg (necks from behind, sitting).
arms — "the whole arm" (a hand without a forearm reads as broken): for every shot the frame nearest to fraction --at and the gesture
frames (--all — all journal frames), a crop of every arm from the shoulder to the fingertips with a margin (the box by the shoulder joint,
elbow, wrist and hand; check that the sleeve goes from the shoulder to the elbow, the forearm is visible to the wrist and the hand continues
it). Sheets arms_NN.jpg with 20 cells, joint points on the crop: shoulder, elbow, wrist.
necks — every journal frame, every figure: a 1:1 crop of the head and the neck (front — by the head journal: skull centre and collar; from
behind — by body points), the caption has the turn, tilt, looking down and the neck violations from report.json. --pair — the same frame
from another journal next to it (before the edit): a cell "before | after". One head pose in a shot — one crop (--all — all frames).
Sheets necks_NN.jpg; --cell — cell side (300).
"""
import argparse
import json
import sys
from pathlib import Path
from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from tools.sheet import font  # noqa: E402

CELL = 300
BAR = 64
COLS = 6
F1 = font(19)
F2 = font(30)
HANDS = {'R': 'right', 'L': 'left'}


def crop_box(img, cx, cy, side):
    side = int(side)
    x0, y0 = int(cx - side / 2), int(cy - side / 2)
    canvas = Image.new('RGB', (side, side), (14, 16, 26))
    if x0 >= img.width or y0 >= img.height or x0 + side <= 0 or y0 + side <= 0:
        return canvas
    src = img.crop((max(0, x0), max(0, y0), min(img.width, x0 + side), min(img.height, y0 + side)))
    canvas.paste(src, (max(0, -x0), max(0, -y0)))
    return canvas


def fit(c, cell=CELL):
    k = min(1.0, cell / max(c.width, c.height))
    if k < 1:
        c = c.resize((round(c.width * k), round(c.height * k)), Image.LANCZOS)
    return c, k


def grid(items, out, title, cols=COLS, cell=CELL, ch=None):
    """Sheet of cells cell × ch (ch defaults to cell) with a caption under each."""
    ch = ch or cell
    rows = (len(items) + cols - 1) // cols
    sheet = Image.new('RGB', (cols * cell, 56 + rows * (ch + BAR)), (14, 16, 26))
    d = ImageDraw.Draw(sheet)
    d.text((14, 10), title, fill=(235, 238, 245), font=F2)
    for i, (img, lab) in enumerate(items):
        x = (i % cols) * cell
        y = 56 + (i // cols) * (ch + BAR)
        sheet.paste(img, (x + (cell - img.width) // 2, y + (ch - img.height) // 2))
        d.multiline_text((x + 8, y + ch + 4), lab, fill=(255, 190, 90), font=F1, spacing=2)
    sheet.save(out, quality=93)
    return out


def fix(q):
    """A journal point in frame pixels: the Remotion render page is shifted by −1 000 000 in y (getScreenCTM sees it)."""
    return [q[0], q[1] + 1_000_000 if q[1] < -500_000 else q[1]]


def hand_crops(rec, img):
    """Hand crops of one journal frame: [(image, caption)]."""
    out = []
    for fig in rec['figs']:
        for a in fig['arms']:
            if a.get('hideHand'):
                continue
            w, t = fix(a['scr']['W']), fix(a['scr']['tip'])
            cx, cy = (w[0] + t[0]) / 2, (w[1] + t[1]) / 2
            if not (0 <= cx < img.width and 0 <= cy < img.height):
                continue
            hl = ((t[0] - w[0]) ** 2 + (t[1] - w[1]) ** 2) ** 0.5
            c, k = fit(crop_box(img, cx, cy, max(150, 2.4 * hl)))
            back = ' · from behind' if a['back'] else ''
            out.append((c, f"{rec['shot']} · {fig['who']} · {HANDS[a['hand']]}\n{a['hold']}{back}{'' if k == 1 else f' (×{k:.2f})'}"))
    return out


def load(work, src):
    poses = json.loads((work / src / 'poses.json').read_text(encoding='utf-8'))
    tl = json.loads((work / 'timeline.json').read_text(encoding='utf-8'))
    shots = {s['id']: s for s in tl['shots']}
    return poses, shots


def pick(poses, shots, at):
    """For every shot — the journal record with the frame nearest to fraction at."""
    by = {}
    for p in poses:
        s = shots[p['shot']]
        want = s['from'] + at * (s['to'] - s['from'])
        if p['shot'] not in by or abs(p['frame'] - want) < abs(by[p['shot']]['frame'] - want):
            by[p['shot']] = p
    return [by[k] for k in sorted(by)]


def hands(a):
    work = Path(a.work).resolve()
    poses, shots = load(work, a.src)
    out = work / a.out
    out.mkdir(parents=True, exist_ok=True)
    for old in out.glob('hands_*.jpg'):
        old.unlink()
    items, necks, n = [], [], 0
    for rec in pick(poses, shots, a.at):
        if not rec['figs']:
            continue
        img = Image.open(work / a.src / 'frames' / f"c_{rec['frame']}.png").convert('RGB')
        items += hand_crops(rec, img)
        for fig in rec['figs']:
            b = {k: fix(v) for k, v in fig['body'].items()}
            ppu = fig['ppu']
            if not (0 <= b['neck'][0] < img.width and 0 <= b['neck'][1] < img.height):
                continue
            if fig['back']:
                c, k = fit(crop_box(img, b['neck'][0], b['neck'][1] + 20 * ppu, max(160, 260 * ppu)))
                necks.append((c, f"{rec['shot']} · {fig['who']}\nneck from behind{'' if k == 1 else f' (×{k:.2f})'}"))
            if fig.get('clip'):
                c, k = fit(crop_box(img, b['hip'][0], (b['neck'][1] + b['hip'][1]) / 2, max(200, 520 * ppu)))
                necks.append((c, f"{rec['shot']} · {fig['who']}\nsitting{'' if k == 1 else f' (×{k:.2f})'}"))
    paths = []
    for i in range(0, len(items), 24):
        n += 1
        # title — the chapter folder name
        paths.append(grid(items[i:i + 24], out / f'hands_{n:02d}.jpg', f'Hands {work.name} — 1:1 crops, sheet {n} (shot · who · hand · grip)'))
    if necks:
        paths.append(grid(necks, out / 'necks_sitting.jpg', 'Necks from behind and sitting poses — 1:1 crops'))
    print('\n'.join(str(p) for p in paths))
    print(f'hands: {len(items)}', file=sys.stderr)


def arm_crops(rec, img, marks=True):
    """"Whole arm" crops of one journal frame: [(image, caption)]. An arm — if its hand or elbow is in the frame."""
    out = []
    for fig in rec['figs']:
        ppu = fig['ppu']
        for a in fig['arms']:
            sc = a['scr']
            pts = {k: fix(sc[k]) for k in ('S', 'E', 'W', 'tip') if sc.get(k)}
            inside = lambda q: 0 <= q[0] < img.width and 0 <= q[1] < img.height
            hand_in = not a.get('hideHand') and inside([(pts['W'][0] + pts['tip'][0]) / 2, (pts['W'][1] + pts['tip'][1]) / 2])
            if not hand_in and not inside(pts['E']):
                continue
            xs = [q[0] for q in pts.values()]
            ys = [q[1] for q in pts.values()]
            pad = 0.28 * a['L1'] * ppu
            x0, x1, y0, y1 = min(xs) - pad, max(xs) + pad, min(ys) - pad, max(ys) + pad
            side = max(x1 - x0, y1 - y0, 120)
            cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
            c = crop_box(img, cx, cy, side)
            if marks:
                d = ImageDraw.Draw(c)
                ox, oy = cx - side / 2, cy - side / 2
                for k, col in (('S', (80, 200, 255)), ('E', (255, 210, 60)), ('W', (255, 80, 160))):
                    q = pts[k]
                    r0 = max(3, side / 90)
                    d.ellipse((q[0] - ox - r0, q[1] - oy - r0, q[0] - ox + r0, q[1] - oy + r0), outline=col, width=max(2, int(side / 200)))
            # a small figure of a wide shot — larger (up to ×3), so the arm reads on the sheet
            if c.width < 0.7 * CELL_R:
                kk = min(3.0, 0.8 * CELL_R / c.width)
                c = c.resize((round(c.width * kk), round(c.height * kk)), Image.LANCZOS)
                k = kk
            else:
                c, k = fit(c, CELL_R)
            back = ' · from behind' if a['back'] else ''
            hid = ' · hand hidden' if a.get('hideHand') else ''
            pose = f" · {a['pose']}" if a.get('pose') else ''
            out.append((c, f"{rec['shot']} · frame {rec['frame']} · {fig['who']}\n{HANDS[a['hand']]} · {a['hold']}{pose}{back}{hid}{'' if k == 1 else f' ×{k:.2f}'}"))
    return out


CELL_R = 380


def arms(a):
    work = Path(a.work).resolve()
    poses, shots = load(work, a.src)
    out = work / a.out
    out.mkdir(parents=True, exist_ok=True)
    for old in out.glob('arms_*.jpg'):
        old.unlink()
    if a.all:
        recs = sorted(poses, key=lambda p: (p['shot'], p['frame']))
    else:
        tl = json.loads((work / 'timeline.json').read_text(encoding='utf-8'))
        want = {}
        for p in pick(poses, shots, a.at):
            want.setdefault(p['shot'], set()).add(p['frame'])
        # gesture frames: the journal records nearest to 35 % and 75 % of every gesture
        for sh in tl['shots']:
            for e in (sh.get('stage') or {}).get('events', []):
                if e.get('do') != 'gesture' or e.get('t0') is None:
                    continue
                for q in (0.35, 0.75):
                    f0 = sh['from'] + round((e['t0'] + q * (e['t1'] - e['t0'])) * tl['fps'])
                    cand = [p for p in poses if p['shot'] == sh['id']]
                    if cand:
                        want.setdefault(sh['id'], set()).add(min(cand, key=lambda p: abs(p['frame'] - f0))['frame'])
        recs = sorted([p for p in poses if p['frame'] in want.get(p['shot'], ())], key=lambda p: (p['shot'], p['frame']))
    items = []
    for rec in recs:
        if not rec['figs']:
            continue
        img = Image.open(work / a.src / 'frames' / f"c_{rec['frame']}.png").convert('RGB')
        items += arm_crops(rec, img)
    paths = []
    for i in range(0, len(items), 20):
        paths.append(grid(items[i:i + 20], out / f'arms_{i // 20 + 1:02d}.jpg', f'Whole arm — from the shoulder to the hand, sheet {i // 20 + 1} (points: shoulder, elbow, wrist)', cols=5, cell=CELL_R))
    print('\n'.join(str(p) for p in paths))
    print(f'arms: {len(items)}', file=sys.stderr)


def neck_box(fig, img):
    """Crop of the head and neck of a figure: (cx, cy, side) or None if the neck is out of frame."""
    ppu = fig['ppu']
    h = fig.get('head')
    if h and h.get('jaw') and not fig['back']:
        k = fix(h['skull'])
        c = [fix(q) for q in h['collar']]
        cm = [(c[0][0] + c[1][0]) / 2, (c[0][1] + c[1][1]) / 2]
        d = max(20, cm[1] - k[1])
        cx, cy, side = (k[0] + cm[0]) / 2, k[1] + 0.62 * d, max(110, 2.3 * d)
    else:
        b = {kk: fix(v) for kk, v in fig['body'].items()}
        cx, cy, side = b['neck'][0], b['neck'][1] - 40 * ppu, max(110, 330 * ppu)
    if not (0 <= cx < img.width and 0 <= cy < img.height):
        return None
    return cx, cy, side


def necks(a):
    work = Path(a.work).resolve()
    poses, shots = load(work, a.src)
    out = work / a.out
    out.mkdir(parents=True, exist_ok=True)
    for old in out.glob('necks_*.jpg'):
        old.unlink()
    only = a.shots.split(',') if a.shots else None
    who = a.who.split(',') if a.who else None
    rep_p = work / a.src / 'report.json'
    bad = {}
    if rep_p.exists():
        for r in json.loads(rep_p.read_text(encoding='utf-8'))['rows']:
            if r.get('side') == 'neck' and r['out']:
                bad[(r['frame'], r['who'])] = ', '.join(o['rule'] for o in r['out'])
    pair = None
    if a.pair:
        pair = {p['frame']: p for p in json.loads((work / a.pair / 'poses.json').read_text(encoding='utf-8'))}
    items = []
    seen = set()
    for rec in sorted(poses, key=lambda p: (p['shot'], p['frame'])):
        if only and rec['shot'] not in only:
            continue
        # one and the same head pose in a shot — one crop (--all — all journal frames)
        def key(f):
            h = f.get('head') or {}
            return (rec['shot'], f['who'], f['back'], round(float(h.get('turn', 0)), 2), round(float(h.get('tilt', 0)), 1), round(float(h.get('gy', 0)), 2), round(float(h.get('dy', 0))))
        figs = [f for f in rec['figs'] if (not who or f['who'] in who) and (a.all or key(f) not in seen)]
        seen.update(key(f) for f in figs)
        if not figs:
            continue
        img = Image.open(work / a.src / 'frames' / f"c_{rec['frame']}.png").convert('RGB')
        for fig in figs:
            bx = neck_box(fig, img)
            if not bx:
                continue
            c = crop_box(img, *bx)
            k = 1.0
            if c.width < 160:
                k = 160 / c.width
                c = c.resize((160, 160), Image.LANCZOS)
            h = fig.get('head') or {}
            lab = f"{rec['shot']} · {rec['frame']} · {fig['who']}"
            info = 'from behind' if fig['back'] else f"turn {float(h.get('turn', 0)):.2f} tilt {float(h.get('tilt', 0)):.0f}° down {float(h.get('gy', 0)):.2f}"
            flag = bad.get((rec['frame'], fig['who']))
            if pair is not None:
                pr = pair.get(rec['frame'])
                pf = next((f for f in (pr or {}).get('figs', []) if f['who'] == fig['who']), None)
                src2 = work / a.pair / 'frames' / f"c_{rec['frame']}.png"
                if pf and src2.exists():
                    c2 = crop_box(Image.open(src2).convert('RGB'), *bx)
                    if k != 1:
                        c2 = c2.resize((160, 160), Image.LANCZOS)
                    both = Image.new('RGB', (c.width * 2 + 8, c.height), (255, 190, 90))
                    both.paste(c2, (0, 0))
                    both.paste(c, (c.width + 8, 0))
                    c = both
            k2 = min(1.0, a.cell / c.height)
            if k2 < 1:
                c = c.resize((round(c.width * k2), round(c.height * k2)), Image.LANCZOS)
            kk = k * k2
            items.append((c, f"{lab}{'' if abs(kk - 1) < 0.01 else f' ×{kk:.2f}'}\n{info}{' · ' + flag.upper() if flag else ''}"))
    paths = []
    cols = max(2, round(1800 / (a.cell * (2 if pair is not None else 1))))
    per = cols * (2 if a.cell >= 300 else 4)
    for i in range(0, len(items), per):
        title = f"Necks — {'before | after, ' if pair is not None else ''}head and neck crops, sheet {i // per + 1}"
        paths.append(grid(items[i:i + per], out / f'necks_{i // per + 1:02d}.jpg', title, cols=cols, cell=a.cell * (2 if pair is not None else 1) + (8 if pair is not None else 0) + 12, ch=a.cell))
    print('\n'.join(str(p) for p in paths))
    print(f'necks: {len(items)}', file=sys.stderr)


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('mode', choices=['hands', 'arms', 'necks'])
    ap.add_argument('work')
    ap.add_argument('--src', default='check/arms')
    ap.add_argument('--out', default='check/hands')
    ap.add_argument('--at', type=float, default=0.55)
    ap.add_argument('--all', action='store_true')
    ap.add_argument('--pair')
    ap.add_argument('--shots')
    ap.add_argument('--who')
    ap.add_argument('--cell', type=int, default=300)
    a = ap.parse_args()
    {'hands': hands, 'arms': arms, 'necks': necks}[a.mode](a)
