"""Automatic staging checks (docs/STAGING.md) — part of the check step: by timeline.json data, by frames of the finished video,
by the frame journal (layout), by sound and by kit code.

By data (tools/pipeline/staging.py check_timeline): sound without an event, prop state jump at a cut, step pace,
sound on a cut, script action without an event, motion without a cause (a door without a hand), cue on visible motion,
shot without an ambience bed, manual sound bindings (cue, @).
By frames (ffmpeg → grey frames, without the title bar strip at the top):
- jump: within one frame of a shot a visible patch changed while the frame is calm before and after (door, prop, figure, text);
  windows of lamp events and in-shot cuts (cut) are not counted;
- small jump: a small patch (ear, hand, sign) changed within one frame and stayed, while the place is still before and after;
- jitter of a static shot: the background of a shot with move = static shakes back and forth (frame shift by phase correlation);
- sound on a still frame: at a one-shot sound or a step nothing moves in the frame (except events with "offscreen": true);
- drift of a static shot (background moves more than DRIFT_PX) and camera jerk (frame edge moving faster than JERK_PX per frame):
  4×4 tiles, shift and scale with sub-pixel precision; tiles with figures (journal) and a moving prop are skipped (cam_checks).
By the frame journal (tools/stage_layout.mjs → check/staging/layout.json; data-stage marks, lib/staging/journal.tsx):
- text card on a figure's head; non-text (line) at the title bar and the frame edge; a required text of the shot (a room number, a
  sign, a display) is not fully visible in any frame of the shot or is covered by a prop;
- any text of the kit (texts, collected by the journal itself): halved under the title bar, cut by the frame edge or by its box,
  rotated, squeezed, out of its sign (text_rules);
- event without a visible change: look, gesture, the hand of an event, the hand at a door leaf (event_checks, pixels of event frames —
  check/staging/png);
- view not as in cast (figure_checks); props of a place: jump at a cut, change between scenes, needs without a figure (prop_checks);
  appearing and vanishing within one frame, a hand leaving faster than 0.25 s (pop_checks); a walk with "at" ends at the prop mark;
- a step sounds while the figure is not visible; steps are muted (offscreen) while the figure is visible; a figure stands inside a prop
  (path through a prop).
By sound: ambience dropout at a cut (audio/amb.wav); a phone voice is in the phone band (voices.json → effects.<effect>.band); a line
quieter than its neighbours.
By kit code: motion timing by shot fractions in kit code (it must come from an event).
Report — check/staging/report.md, the table of sounds with events — check/staging/sounds.md.

Standalone: python tools/pipeline/stage_check.py <work folder> [--video file.mp4 --shots 04.01,04.02 --out folder] [--no-layout] [--no-video] [--keep-png]
(--video — a clip of one scene or shot: time starts at the first shot of --shots; --keep-png — keep the event frames check/staging/png).
"""
import json
import re
import subprocess
import sys
from pathlib import Path

import numpy as np

W, H, TOP = 480, 270, 22  # analysis frame; TOP — the title bar strip (with the stamp under it)
POP_AREA = 0.004  # share of the frame changed within one frame
STILL = 0.00002  # share of the frame: below this nothing moves in the frame
SW, SH, STOP = 960, 540, 44  # analysis frame of the small jump
SMALL_MIN, SMALL_MAX = 25, 2600  # patch of a small jump, px of the analysis frame (≈ 10×10 … 100×100 px of a 1920 frame)
SMALL_CORE = 10  # this many patch pixels survive erosion by 1 px: a text line shifted by a pixel (edges) is not a patch
# frame size of the timeline, px: the journal coordinates are frame pixels (set by run from timeline.json)
FW, FH = 1920, 1080
BAR_H = 50  # title bar height, px (lib/hud/hud.tsx BAR_H)
PNG_SCALE = 0.5  # event frames for the pixel check — 960×540


def gray(video: Path, start: float, dur: float, w=W, h=H, top=TOP) -> np.ndarray:
    cmd = ['ffmpeg', '-v', 'error', '-ss', f'{start:.4f}', '-t', f'{dur:.4f}', '-i', str(video), '-vf', f'scale={w}:{h},format=gray',
           '-f', 'rawvideo', '-']
    raw = subprocess.run(cmd, capture_output=True, check=True).stdout
    return np.frombuffer(raw, np.uint8).reshape(-1, h, w)[:, top:, :]


def shift_of(a: np.ndarray, b: np.ndarray):
    """Shift of frame b relative to a, px of the analysis frame (phase correlation)."""
    fa, fb = np.fft.rfft2(a.astype(np.float32)), np.fft.rfft2(b.astype(np.float32))
    r = fa * np.conj(fb)
    c = np.fft.irfft2(r / (np.abs(r) + 1e-6), s=a.shape)
    y, x = np.unravel_index(int(np.argmax(c)), c.shape)
    return (x if x < a.shape[1] / 2 else x - a.shape[1]), (y if y < a.shape[0] / 2 else y - a.shape[0])


def bg_shift(a: np.ndarray, b: np.ndarray):
    """Background shift of frame b relative to a: median of the shifts over nine tiles. Camera jitter moves all tiles alike,
    while a prop in the frame (door leaf, figure) moves only its own: large motion in part of the frame is not taken for jitter."""
    h, w = a.shape
    th, tw = h // 3, w // 3
    xs, ys = [], []
    for i in range(3):
        for j in range(3):
            ta, tb = a[i * th:(i + 1) * th, j * tw:(j + 1) * tw], b[i * th:(i + 1) * th, j * tw:(j + 1) * tw]
            if ta.std() < 6:  # smooth tile — no shift is measured on it
                continue
            x, y = shift_of(ta, tb)
            xs.append(x)
            ys.append(y)
    if len(xs) < 3:
        return shift_of(a, b)
    return float(np.median(xs)), float(np.median(ys))


def quiet_windows(shot: dict) -> list:
    """Windows of the shot where a sharp frame change comes from an event: a lamp, an in-shot cut."""
    evs = shot.get('stage', {}).get('events', [])
    out = [[e['t0'] - 0.1, e['t1'] + 0.45] for e in evs if e['do'].startswith('lamp.')]
    out += [[e['t0'] - 0.08, e['t0'] + 0.08] for e in evs if e['do'] == 'cut']
    out += [[a - 0.1, b + 0.3] for a, b in shot.get('flicker', [])]
    if shot.get('lampOff') is not None:
        out.append([shot['lampOff'] - 0.1, shot['lampOff'] + 0.45])
    return out


def blobs(mask: np.ndarray, cell: int = 8) -> list:
    """Patches of a mask: cell×cell cells with changed pixels merged with neighbours. → [(px count, y0, y1, x0, x1)]."""
    h, w = mask.shape
    gh, gw = h // cell, w // cell
    cells = mask[:gh * cell, :gw * cell].reshape(gh, cell, gw, cell).sum(axis=(1, 3))
    todo = {(int(y), int(x)) for y, x in zip(*np.where(cells > 0))}
    out = []
    while todo:
        stack = [todo.pop()]
        grp = []
        while stack:
            y, x = stack.pop()
            grp.append((y, x))
            for dy in (-1, 0, 1):
                for dx in (-1, 0, 1):
                    q = (y + dy, x + dx)
                    if q in todo:
                        todo.remove(q)
                        stack.append(q)
        ys = [q[0] for q in grp]
        xs = [q[1] for q in grp]
        y0, y1, x0, x1 = min(ys) * cell, (max(ys) + 1) * cell, min(xs) * cell, (max(xs) + 1) * cell
        out.append((int(mask[y0:y1, x0:x1].sum()), y0, y1, x0, x1))
    return out


def small_pops(g: np.ndarray, fps: int, quiet: list, moving: bool) -> list:
    """Small jump: a patch changed within one frame and stayed, while the place is still before and after (ear, hand, prop).
    g — grey frames of the shot SW×SH. Patches are found one by one: motion elsewhere in the frame (speech, a step, dust) does not interfere.
    → [(t, area in px of a 1920 frame, box)]."""
    if len(g) < 12:
        return []
    out = []
    d = np.abs(g[1:].astype(np.int16) - g[:-1].astype(np.int16)) > 26
    cnt = d.reshape(len(d), -1).sum(axis=1)
    k0 = FW // SW
    for k in np.where(cnt >= SMALL_MIN)[0]:
        t = (k + 1) / fps
        if k < 5 or k > len(d) - 6 or any(a <= t <= b for a, b in quiet):
            continue
        for n, y0, y1, x0, x1 in blobs(d[k]):
            if n < SMALL_MIN or n > SMALL_MAX or (x1 - x0) > 160 or (y1 - y0) > 160 or (x1 - x0) >= 4 * (y1 - y0):
                continue  # not a patch: a large area or a text line strip (on a slow push-in a line shifts by a pixel)
            m = d[k, y0:y1, x0:x1]
            core = m[1:-1, 1:-1] & m[:-2, 1:-1] & m[2:, 1:-1] & m[1:-1, :-2] & m[1:-1, 2:]
            if core.sum() < max(SMALL_CORE, 0.12 * n):
                continue  # thin edges: a text line or a line shifted by a pixel on a slow push-in — not a prop jump
            py, px = 8, 8
            Y0, Y1, X0, X1 = max(0, y0 - py), min(g.shape[1], y1 + py), max(0, x0 - px), min(g.shape[2], x1 + px)
            near = [int(d[i, Y0:Y1, X0:X1].sum()) for i in (k - 4, k - 3, k - 2, k - 1, k + 1, k + 2, k + 3, k + 4)]
            if max(near) > 0.12 * n:
                continue  # the place moves anyway (a step, speech, strands) — not a jump
            # did the new state stay: frames after differ from frames before
            before = g[k - 2, y0:y1, x0:x1].astype(np.int16)
            after = g[k + 3, y0:y1, x0:x1].astype(np.int16)
            if (np.abs(after - before) > 26).sum() < 0.6 * n:
                continue  # a one-frame flash and back — not "appeared and stayed"
            if moving and n < 150:
                continue  # while the camera moves, letters and edges jump by a pixel in patches — catch only large ones
            out.append((t, int(n) * k0 * k0, [int(x0 * k0), int((y0 + STOP) * k0), int(x1 * k0), int((y1 + STOP) * k0)]))
    # the same patch jumps three times or more in a shot — drawn motion by phases (a wagging tail, a blinking light), not a prop jump
    same = lambda a, b: abs(a[0] - b[0]) < 48 and abs(a[1] - b[1]) < 48
    return [v for v in out if sum(1 for w in out if same(v[2], w[2])) < 3]


# ---------- camera by frames: drift of a static shot, camera jerk ----------

DRIFT_PX = 1.5  # background shift over a static shot, px 1920: beyond this — "drift" (accepted shots — ≤ 0.5)
OBJ_MOVES = ('paper.', 'box.', 'stamp.', 'beam.', 'drop.', 'lamp.', 'door.', 'window.', 'hand.')  # move a large prop or the light: not the camera
DRIFT_STEP = 6.0  # px 1920 per 0.5 s: more is a camera move (judged by "camera jerk"), not drift
JERK_PX = 40  # speed of the frame edge while the camera moves (90th percentile), px 1920 per frame: a jerk ≈ 50, accepted push-ins 13–30
_hwin = {}


def sub_shift(a: np.ndarray, b: np.ndarray):
    """Shift of b relative to a with sub-pixel precision (phase correlation, parabola at the peak) and the peak height."""
    if a.shape not in _hwin:
        _hwin[a.shape] = np.outer(np.hanning(a.shape[0]), np.hanning(a.shape[1])).astype(np.float32)
    w = _hwin[a.shape]
    fa, fb = np.fft.rfft2((a - a.mean()) * w), np.fft.rfft2((b - b.mean()) * w)
    r = fa * np.conj(fb)
    c = np.fft.irfft2(r / (np.abs(r) + 1e-6), s=a.shape)
    y, x = np.unravel_index(int(np.argmax(c)), c.shape)
    h, ww = c.shape

    def par(m1, m0, p1):
        d = m1 - 2 * m0 + p1
        return 0.0 if abs(d) < 1e-9 else 0.5 * (m1 - p1) / d
    dx = par(c[y, (x - 1) % ww], c[y, x], c[y, (x + 1) % ww])
    dy = par(c[(y - 1) % h, x], c[y, x], c[(y + 1) % h, x])
    return -((x if x < ww / 2 else x - ww) + dx), -((y if y < h / 2 else y - h) + dy), float(c[y, x])


def shift_explains(ta: np.ndarray, tb: np.ndarray, dx: float, dy: float) -> bool:
    """Does the tile shift (dx, dy) explain frame b better than "the tile stands still"? Phase correlation on a dark tile with almost no
    texture latches on a couple of flying dust specks and gives a 1–3 px shift although the tile did not change (a false "drift" up to
    20 px): of the two hypotheses the one with the smaller difference to frame b wins (bilinear shift, no borders)."""
    m = int(np.ceil(max(abs(dx), abs(dy)))) + 1
    h, w = ta.shape
    if 2 * m >= min(h, w) - 8:
        return True  # a large move is judged by "camera jerk", not drift
    ys = np.arange(m, h - m, dtype=np.float32)[:, None] - dy
    xs = np.arange(m, w - m, dtype=np.float32)[None, :] - dx
    y0, x0 = np.floor(ys).astype(int), np.floor(xs).astype(int)
    fy, fx = ys - y0, xs - x0
    warped = (ta[y0, x0] * (1 - fx) * (1 - fy) + ta[y0, x0 + 1] * fx * (1 - fy)
              + ta[y0 + 1, x0] * (1 - fx) * fy + ta[y0 + 1, x0 + 1] * fx * fy)
    inner = tb[m:h - m, m:w - m]
    return float(np.abs(warped - inner).mean()) < float(np.abs(ta[m:h - m, m:w - m] - inner).mean())


def cam_fit(a: np.ndarray, b: np.ndarray, mask=None):
    """Camera of frame b relative to a over 4×4 tiles: scale s and shift (tx, ty) in px of the analysis frame, share of agreeing tiles;
    tiles with a figure (mask) and smooth ones are skipped, a moving prop (door leaf, sheet) is a fit outlier. → (s, tx, ty, share) or None."""
    h, w = a.shape
    th, tw = h // 4, w // 4
    C, D = [], []
    for i in range(4):
        for j in range(4):
            if mask is not None and mask[i, j]:
                continue
            ta, tb = a[i * th:(i + 1) * th, j * tw:(j + 1) * tw], b[i * th:(i + 1) * th, j * tw:(j + 1) * tw]
            if ta.std() < 5:
                continue
            dx, dy, pk = sub_shift(ta, tb)
            if pk < 0.08:
                continue
            if np.hypot(dx, dy) >= 0.5 and not shift_explains(ta, tb, dx, dy):  # a bilinear shift blurs a sub-pixel fraction — it is not judged
                dx, dy = 0.0, 0.0
            C.append(((j + 0.5) * tw - w / 2, (i + 0.5) * th - h / 2))
            D.append((dx, dy))
    if len(C) < 5:
        return None
    C, D = np.array(C), np.array(D)
    keep = np.ones(len(C), bool)
    p = None
    for _ in range(4):
        cc, dd = C[keep], D[keep]
        A = np.zeros((2 * len(cc), 3))
        A[0::2, 0], A[0::2, 1] = cc[:, 0], 1
        A[1::2, 0], A[1::2, 2] = cc[:, 1], 1
        p, *_ = np.linalg.lstsq(A, dd.reshape(-1), rcond=None)
        res = np.hypot(*(D - np.stack([p[0] * C[:, 0] + p[1], p[0] * C[:, 1] + p[2]], axis=1)).T)
        nk = res < max(0.75, 2.5 * np.median(res[keep]))
        if (nk == keep).all():
            break
        keep = nk
        if keep.sum() < 4:
            return None
    return 1 + p[0], p[1], p[2], float(keep.mean())


def cam_checks(s: dict, gs: np.ndarray, fps: float, figs=None) -> list:
    """Drift of a static shot (slow shift or push of the background at rest, production rule 2; also papers with "drift") and camera jerk
    (rule 1: a push-in over 1.3 s with ~50 px per frame). gs — grey frames of the shot 960 × (540 − STOP); figs — figure boxes of the shot
    (px 1920) from the journal: tiles with them are skipped."""
    if len(gs) < 20:
        return []
    h, w = gs.shape[1:]
    k = FW / w
    mask = None
    if figs:
        mask = np.zeros((4, 4), bool)
        for r in figs:
            dw = 0.25 * (r[2] - r[0])  # figure box — by the body; arms, hair, a held prop are wider
            r = [r[0] - dw, r[1] - 0.1 * (r[3] - r[1]), r[2] + dw, r[3]]
            x0, x1 = int(max(0, r[0] / k) // (w / 4)), int(min(w - 1, r[2] / k) // (w / 4))
            y0, y1 = int(max(0, r[1] / k - STOP) // (h / 4)), int(min(h - 1, r[3] / k - STOP) // (h / 4))
            if x1 >= 0 and y1 >= 0 and x0 <= 3 and y0 <= 3:
                mask[max(0, y0):min(3, y1) + 1, max(0, x0):min(3, x1) + 1] = True
    k0 = int((s.get('dipIn', 0) + 0.1) * fps) if s.get('dipIn') else 2
    k1 = len(gs) - (int((s.get('dipOut', 0) + 0.1) * fps) if s.get('dipOut') else 2)
    out = []
    half = np.hypot(w / 2, h / 2)
    busy = [(e['t0'] - 0.1, e['t1'] + 0.1) for e in s.get('stage', {}).get('events', []) if e['do'].startswith(OBJ_MOVES)]
    calm = lambda i, n: not any(a <= (i + n) / fps and i / fps <= b for a, b in busy)
    # jerk: speed of the frame edge over pairs of frames two apart
    sp = []
    for i in range(k0, k1 - 2, 2):
        if not calm(i, 2):
            sp.append((i, 0.0))
            continue
        c = cam_fit(gs[i], gs[i + 2], mask)
        sp.append((i, k * (np.hypot(c[1], c[2]) + abs(c[0] - 1) * half) / 2 if c and c[3] >= 0.5 else 0.0))
    runs, cur = [], []
    for i, v in sp + [(None, 0.0)]:
        if v > 1.5:
            cur.append((i, v))
        elif cur:
            runs.append(cur)
            cur = []
    for r in runs:
        vals = np.array([v for _, v in r])
        if len(vals) >= 3 and np.percentile(vals, 90) > JERK_PX:
            t0, t1 = r[0][0] / fps, (r[-1][0] + 2) / fps
            out.append({'shot': s['id'], 'rule': 'camera jerk', 'level': 'error', 't': round(s['start'] + t0, 2),
                        'msg': f'the camera at {t0:.2f}–{t1:.2f} s of the shot moves with an edge speed of {np.percentile(vals, 90):.0f} px per frame (peak {vals.max():.0f}; '
                               f'threshold {JERK_PX}) — make the camera move even and longer, like accepted push-ins'})
    # drift: shift over 0.5 s, without the scale part (a push-in towards an off-centre point is not drift), accumulated path
    if s['move'] == 'static' and not s.get('shake'):
        allp = []
        for i in range(k0, k1 - 15, 15):
            c = cam_fit(gs[i], gs[i + 15], mask) if calm(i, 15) else None
            allp.append(c if c and c[3] >= 0.6 else None)
        moving = [c is not None and k * (np.hypot(c[1], c[2]) + abs(c[0] - 1) * half) > DRIFT_STEP for c in allp]
        # pairs next to a camera move (acceleration and braking of an intended push-in or fly-by) are also a move, not drift
        pairs = [c for n, c in enumerate(allp) if c is not None and not any(moving[max(0, n - 1):n + 2])]
        if len(pairs) >= 3:
            # accumulated path: shift and scale (drift by zoom is drift too, e.g. papers with "drift"), px 1920 at the frame edge
            tr = np.cumsum([[c[1], c[2]] for c in pairs], axis=0) * k
            zm = np.cumsum([np.log(c[0]) for c in pairs]) * half * k
            exc = float((np.hypot(tr[:, 0], tr[:, 1]) + np.abs(zm)).max())
            if exc > DRIFT_PX:
                out.append({'shot': s['id'], 'rule': 'drift of a static shot', 'level': 'error', 't': round(s['start'], 2),
                            'msg': f'the background of a static shot moves by {exc:.1f} px (1920×1080) over {len(pairs) * 0.5:.1f} s (threshold {DRIFT_PX} px; a camera move faster than {DRIFT_STEP:.0f} px per 0.5 s is judged by "camera jerk") — '
                                   f'camera and props stand still, motion only by an event'})
    return out


def frame_checks(tl: dict, video: Path, shots: list | None = None, t_base: float | None = None, figs: dict | None = None):
    """→ (issues, motion): motion[shot id] = share of changed pixels per frame of the shot."""
    fps = tl['fps']
    sel = [s for s in tl['shots'] if not shots or s['id'] in shots]
    base = sel[0]['start'] if t_base is None else t_base
    issues, motion = [], {}
    for s in sel:
        g = gray(video, s['start'] - base, s['end'] - s['start'])
        if len(g) < 4:
            continue
        df = np.abs(g[1:].astype(np.int16) - g[:-1].astype(np.int16)) > 24
        d = df.reshape(len(df), -1).mean(axis=1)
        motion[s['id']] = d
        # a dark figure stepping on a dark floor (a uniform at night) gives no difference > 24: inside the figure boxes of the shot
        # (journal) motion is measured with threshold 8 — a share of the frame like d; sound_rows uses it only for steps
        rs = (figs or {}).get(s['id'])
        if rs:
            m = np.zeros(g.shape[1:], bool)
            for x0, y0, x1, y1 in rs:
                ya, yb = max(0, int(y0 * W / FW) - TOP), max(0, int(y1 * W / FW) + 1 - TOP)
                m[ya:yb, max(0, int(x0 * W / FW)):int(x1 * W / FW) + 1] = True
            if m.any():
                dg = np.abs(g[1:].astype(np.int16) - g[:-1].astype(np.int16)) > 8
                motion[s['id'] + '#fig'] = dg[:, m].sum(axis=1) / m.size
        quiet = quiet_windows(s)
        # dip between scenes (dipIn / dipOut, 0.3 s): on a bright frame a dip step at threshold 24 gives a "jump" at the start and end
        # of the dip — the jump check skips dip windows, as does the small jump check
        dip = [[0, s.get('dipIn', 0) + 0.1]] if s.get('dipIn') else []
        dip += [[s['end'] - s['start'] - s.get('dipOut', 0) - 0.1, 1e9]] if s.get('dipOut') else []
        big = set()
        for k in np.where(d >= POP_AREA)[0]:
            t = (k + 1) / fps
            if k < 2 or k > len(d) - 3 or any(a <= t <= b for a, b in quiet + dip):
                continue  # first and last frames of the shot — dip between scenes and the cut
            around = np.concatenate([d[max(0, k - 6):k], d[k + 1:k + 7]])
            like = [i for i in np.where((d > 0.7 * d[k]) & (d < 1.3 * d[k]))[0] if d[i] > 3 * np.median(d[max(0, i - 6):i + 7])]
            periodic = len(like) >= 4  # the same spikes over the whole shot — a blinking indicator, not a jump
            if d[k] > 6 * np.median(around) + 0.002 and d[k] > 3 * around.max() and not periodic:
                ys, xs = np.where(df[k])
                box = [int(xs.min() * 4), int((ys.min() + TOP) * 4), int(xs.max() * 4), int((ys.max() + TOP) * 4)]
                big.add(int(k))
                issues.append({'shot': s['id'], 'rule': 'jump in frame', 'level': 'error', 't': round(s['start'] + t, 2),
                               'msg': f'at {t:.2f} s of the shot {d[k] * 100:.1f} % of the frame changed within one frame, box {box} (px 1920×1080)'})
        # small jump — on frames twice as large
        gs = gray(video, s['start'] - base, s['end'] - s['start'], SW, SH, STOP)
        issues += cam_checks(s, gs.astype(np.float32), fps, (figs or {}).get(s['id']))
        seen = []
        for t, area, box in small_pops(gs, fps, quiet + dip, s['move'] != 'static' or bool(s.get('drift'))):
            if int(round(t * fps)) - 1 in big or any(abs(t - t2) < 0.5 and abs(box[0] - b2[0]) < 60 for t2, b2 in seen):
                continue
            seen.append((t, box))
            issues.append({'shot': s['id'], 'rule': 'small jump', 'level': 'error', 't': round(s['start'] + t, 2),
                           'msg': f'at {t:.2f} s of the shot a patch of {area} px changed within one frame, box {box} (px 1920×1080), the place is still before and after'})
        if s['move'] == 'static' and not s.get('drift') and not s.get('shake') and not any('scared' in c.get('emo', []) for c in s['cast']):
            k0 = min(len(g) - 1, int((s.get('dipIn', 0) + 0.07) * fps)) if s.get('dipIn') else 0  # reference frame — after the dip between scenes
            k1 = len(g) - int((s.get('dipOut', 0) + 0.07) * fps) if s.get('dipOut') else len(g)
            ref = g[k0]
            # camera jitter moves the whole frame: both the whole-frame shift and the median of tile shifts see it. A large moving prop
            # (a door leaf) throws off the whole-frame shift, a slow push-in of an insert — the tiles; only what both see counts as jitter
            def jitter(fn):
                sh = np.array([fn(ref, g[i]) for i in range(k0, max(k0 + 1, k1), 3)], dtype=np.float32)
                if len(sh) <= 6 or np.abs(sh).max() > 12:  # more — the correlation broke (a smooth sheet, a light change), not jitter
                    return 0.0
                hi = sh - np.stack([np.convolve(sh[:, c], np.ones(5) / 5, mode='same') for c in (0, 1)], axis=1)
                return float(np.abs(hi[2:-2]).max())
            jit = jitter(shift_of)
            if jit >= 1.0:
                jit = min(jit, jitter(bg_shift))
            if jit >= 1.0:
                issues.append({'shot': s['id'], 'rule': 'jitter of a static shot', 'level': 'error', 't': round(s['start'], 2),
                               'msg': f'the background jerks by {jit * 4:.0f} px (1920×1080) with move = static'})
    return issues, motion


def sound_rows(tl: dict, motion: dict):
    """Sound table: time, id, shot, event, motion in the frame at the sound. → (rows, issues)."""
    fps = tl['fps']
    shots = {s['id']: s for s in tl['shots']}
    rows, issues = [], []
    for x in sorted(tl['sfx'], key=lambda v: v['start']):
        s = shots[x['shot']]
        ev = x.get('event') or ('ambience bed' if x.get('bed') else 'loop' if x.get('loop') else '— none —')
        off = x.get('offscreen')
        times = x.get('hits') or [x['start']]
        if isinstance(off, list):  # legacy format: windows where the figure is not visible
            times, off = [t for t in times if not any(a <= t <= b for a, b in off)] or times[:1], False
        mv = None
        if x['shot'] in motion and not x.get('loop'):
            d = motion[x['shot']]
            vals = []
            back = 16 if x.get('hits') else 8  # step: the figure was walking towards the foot contact — look at half a second before it (the last step is at the stop)
            dfig = motion.get(x['shot'] + '#fig') if x.get('hits') else None
            for t in times:
                k = int((t - s['start']) * fps)
                v = float(d[max(0, k - back):k + 11].max()) if len(d) else 0.0
                if dfig is not None and len(dfig):
                    v = max(v, float(dfig[max(0, k - back):k + 11].max()))
                vals.append(v)
            mv = min(vals)
            if mv < STILL and not off:
                issues.append({'shot': x['shot'], 'rule': 'sound on a still frame', 'level': 'error', 't': round(times[vals.index(mv)], 2),
                               'msg': f'{x["id"] or x["name"]} at {times[vals.index(mv)] - s["start"]:.2f} s of the shot: nothing moves in the frame '
                                      f'(event "{ev}"); a source out of frame — "offscreen": true on the event'})
        rows.append({'t': x['start'], 'id': x['id'] or x['name'], 'shot': x['shot'], 'n': len(x.get('hits') or [1]), 'event': ev, 'manual': x.get('manual'),
                     'motion': mv, 'offscreen': bool(off), 'loop': bool(x.get('loop')), 'end': x.get('end')})
    return rows, issues


# ---------- frame journal: layout, figure and step sound, path through a prop ----------

CONT_POSES = ('dial', 'write', 'count', 'tap', 'rail')  # repeated gesture: the hand moves for the whole hold (dials, writes, counts, taps)
HAND_ACTS = ('hand.', 'pen.mark')
LEAF_ACTS = ('door.', 'window.')


def ev_peak(e: dict) -> float:
    """Second of the shot when the look or gesture is fully in (lib/staging/stage.ts hold: entry "in", default 0.5 / 0.35 s, "stay" — the whole event)."""
    ln = max(1e-6, e['t1'] - e['t0'])
    tin = e.get('in')
    if tin is None:
        tin = ln if e.get('stay') else min(0.5 if e['do'] == 'look' else 0.35, ln)
    return min(e['t1'], e['t0'] + tin)


def ev_frames(e: dict) -> dict:
    """Event frames for the journal checks: {name: second of the shot}. before — before the event, peak — fully in; hold* — the hold of a
    repeated gesture; run* — the motion of a hand and a door leaf; d±k — dense at the start and end (±2 frames: appearing and vanishing
    within one frame); g* — a hand leaving (≤ 0.25 s)."""
    t0, t1 = e['t0'], e['t1']
    out = {}
    if e['do'] == 'walk' and e.get('at'):
        out['end'] = t1 + 0.05
    if e['do'] in ('look', 'gesture'):
        out['before'] = t0 - 0.1
        out['peak'] = ev_peak(e)
        if e['do'] == 'gesture' and e.get('pose') in CONT_POSES:
            for i in range(4):
                out[f'hold{i}'] = t0 + (t1 - t0) * (0.2 + 0.2 * i)
    if e['do'] == 'gesture' or e['do'].startswith(HAND_ACTS) or e['do'].startswith(LEAF_ACTS):
        for u in (0.05, 0.3, 0.5, 0.7, 0.95):
            out[f'run{u}'] = t0 + (t1 - t0) * u
        for k in (-2, -1, 0, 1, 2):
            out[f'd0{k:+d}'] = t0 + k / 30
            out[f'd1{k:+d}'] = t1 + k / 30
        for g in (0.3, 0.2, 0.1):
            out[f'g{g}'] = t1 - g
    if e['do'].startswith(HAND_ACTS) or e['do'].startswith(LEAF_ACTS):
        for i in range(int((t1 - t0) / 0.1) + 1):  # the motion of a hand and a door leaf every 0.1 s: a hand leaves no faster than 0.25 s
            out[f'r{i}'] = t0 + 0.1 * i
    return out


def layout_jobs(tl: dict, shots: list | None = None) -> list:
    """Frames for the journal: start, middle and end of every shot, the moment of every card, every step and the middle of offscreen windows;
    event frames of look, gesture, hand, door and window (ev_frames). "png": true — the frame is needed as pixels too (visible change check)."""
    fps = tl['fps']
    jobs = {}

    def add(s, t, why, png=False):
        f = min(s['to'] - 1, max(s['from'], s['from'] + int(round(t * fps))))
        j = jobs.setdefault(f, {'shot': s['id'], 'frame': f, 'why': []})
        j['why'].append(why)
        if png:
            j['png'] = True

    steps = {}
    for x in tl['sfx']:
        if x.get('hits'):
            steps.setdefault(x['shot'], []).append(x)
    for s in tl['shots']:
        if shots and s['id'] not in shots:
            continue
        dur = s['end'] - s['start']
        # rest — start and end of the shot, but outside the dips between scenes (under a dip a text is "covered")
        add(s, max(0.06 * dur, s.get('dipIn', 0) + 0.05), 'rest0')
        add(s, 0.5 * dur, 'mid')
        add(s, min(0.97 * dur, dur - s.get('dipOut', 0) - 0.05), 'rest1')
        if s['move'] != 'static' or s.get('drift'):
            for u in (0.25, 0.75):
                add(s, u * dur, 'mid')
        for c in s.get('cards', []):
            if c.get('from'):
                add(s, c['from'] + 0.6, 'mid')
        for x in steps.get(s['id'], []):
            for h in x['hits']:
                add(s, h - s['start'], f'step:{x["who"]}')
        lo, hi = s.get('dipIn', 0) + 0.05, dur - s.get('dipOut', 0) - 0.05
        for i, e in enumerate(s.get('stage', {}).get('events', [])):
            if e['do'] == 'walk':
                for h in e.get('mute', []):
                    add(s, h, f'mute:{e["who"]}')
            if e['do'] in ('walk', 'gesture', 'look'):
                add(s, e['t1'], 'mid')
            for nm, t in ev_frames(e).items():
                if nm.startswith('d') and not lo <= t <= hi:
                    continue  # dense frames at the start and end — only inside the shot
                add(s, min(hi, max(lo, t)), f'ev:{i}:{nm}', png=nm in ('before', 'peak') or nm.startswith('hold'))
    return sorted(jobs.values(), key=lambda j: j['frame'])


ENV_EXIT = 3  # exit code of the node frame scripts: the browser did not start even after a retry (tools/remotion.mjs) — an environment error


def run_layout(tl: dict, wd: Path, out: Path, shots: list | None = None, workers: int = 1, env: list | None = None) -> list | None:
    """Frame journal: node tools/stage_layout.mjs from the code copy (tools/mirror.py). → journal or None (no node / render failed).
    Event frames with "png" are saved to <out>/png (960×540) — pixels for the "event without a visible change" check.
    workers — frames at a time (pages of one browser). The browser did not start even after a retry (code ENV_EXIT, a line "ENVIRONMENT:"
    in layout.log) — not a staging error: the reason goes to env (if given), None is returned."""
    from tools import mirror
    from tools.pipeline.common import node_exe
    jobs = layout_jobs(tl, shots)
    out.mkdir(parents=True, exist_ok=True)
    (out / 'layout.json').unlink(missing_ok=True)  # do not pass an old journal off as new if the run failed
    (out / 'layout_jobs.json').write_text(json.dumps({'timeline': str((wd / 'timeline.json').resolve()), 'jobs': jobs, 'out': str((out / 'layout.json').resolve()),
                                                      'png_dir': str((out / 'png').resolve()), 'png_scale': PNG_SCALE, 'workers': workers}), encoding='utf-8')
    m = mirror.sync()
    with open(out / 'layout.log', 'w', encoding='utf-8') as lf:
        r = subprocess.run([node_exe(), str(Path(m) / 'tools' / 'stage_layout.mjs'), str((out / 'layout_jobs.json').resolve())], cwd=m, stdout=lf, stderr=subprocess.STDOUT)
    if r.returncode == ENV_EXIT and env is not None:
        why = [ln for ln in (out / 'layout.log').read_text(encoding='utf-8', errors='replace').splitlines() if ln.startswith('ENVIRONMENT:')]
        env.append(f'frame journal not collected: {why[-1] if why else "the browser did not start"} — log {out / "layout.log"}')
        return None
    if r.returncode or not (out / 'layout.json').exists():
        return None
    return json.loads((out / 'layout.json').read_text(encoding='utf-8'))


def inter(a, b):
    w, h = min(a[2], b[2]) - max(a[0], b[0]), min(a[3], b[3]) - max(a[1], b[1])
    return max(0.0, w) * max(0.0, h)


def area(a):
    return max(0.0, a[2] - a[0]) * max(0.0, a[3] - a[1])


PX_MIN = 14  # text size in the frame, px: smaller is not read — the text layout rules do not apply
PX_BAR = 8  # a line halved under the title bar is visible even when small (≈ 9 px)
TXT_CUT = 0.12  # halved text: the title bar or the frame edge cuts more than this share of the letter height (and less than 1 − the share)
TXT_ROT = 50  # line rotation, °: a view on stairs and a sticker give up to 44° without complaints, "vertical" text is 77–90°
TXT_SQ = 0.5  # squeeze along an axis: the smaller axis to the larger
TXT_SPILL = 0.12  # letters out of their sign by a share of the letter height
TXT_PLATE = 12  # sign — a backing no larger than this many text areas (larger is a wall, not a sign)
TXT_CLIP = 0.8  # share of letter points in the frame that land on the text itself: less — the text is cut by the box of its prop (clip-path)


def qbox(q):
    return [min(q[0::2]), min(q[1::2]), max(q[0::2]), max(q[1::2])]


def q_outside(q, pq) -> float:
    """How many px the corners of quadrilateral q stick out of the convex quadrilateral pq (0 — inside)."""
    pts = list(zip(pq[0::2], pq[1::2]))
    ar = sum(x0 * y1 - x1 * y0 for (x0, y0), (x1, y1) in zip(pts, pts[1:] + pts[:1]))
    sg = 1 if ar > 0 else -1
    worst = 0.0
    for x, y in zip(q[0::2], q[1::2]):
        for (x0, y0), (x1, y1) in zip(pts, pts[1:] + pts[:1]):
            ex, ey = x1 - x0, y1 - y0
            ln = (ex * ex + ey * ey) ** 0.5 or 1.0
            worst = max(worst, -sg * (ex * (y - y0) - ey * (x - x0)) / ln)
    return worst


def text_rules(j: dict, s: dict, bar, rest: bool, acc: dict, passing: set = frozenset()):
    """Texts of the kit (journal texts: every SVG <text> and HTML text of the kit layer), size from PX_MIN: halved under the title bar (any
    frame — also while the camera moves), halved by the frame edge and cut by the box of its prop (at rest), rotated more than TXT_ROT,
    squeezed more than twice, out of its sign or strip. An intended cut — data-cut-ok on the element."""
    def bad(rule, msg, key):
        a = acc.setdefault((j['shot'], rule), {'t': j['frame'], 'items': {}})
        a['items'].setdefault(key, msg)

    for t in j.get('texts') or []:
        q = t.get('ink')
        if t.get('ok') or not q or t['px'] < PX_BAR or t.get('n', 0) < 2:
            continue  # small, an intended cut, or fewer than two glyphs in the frame
        hit = t.get('hit', 0)
        if hit < 0.05 or (t.get('top', 0) + t.get('hud', 0)) < 0.35 * hit:
            continue  # text covered by a kit prop (behind a figure, behind a door leaf) — it is not visible
        b = qbox(q)
        ih = ((q[6] - q[0]) ** 2 + (q[7] - q[1]) ** 2) ** 0.5 or (b[3] - b[1])
        bh, bw = max(1.0, b[3] - b[1]), max(1.0, b[2] - b[0])
        nm = f'"{t["s"]}"'
        where = f'letters {[round(v) for v in b]}, size {t["px"]:.0f} px'
        small = t['px'] < PX_MIN  # small text is checked only at the title bar
        if bar and (rest or t['s'] not in passing):
            cut = (BAR_H - b[1]) / bh
            if TXT_CUT < cut < 1 - TXT_CUT:
                bad('text under the title bar', f'text {nm} is halved under the title bar: {cut * 100:.0f} % of the letter height is under it ({where}) — keep it fully below the bar or out of frame', t['s'])
        if small:
            continue
        if rest:
            cuts = [('top', -b[1] / bh if not bar else 0), ('bottom', (b[3] - FH) / bh), ('left', -b[0] / bw), ('right', (b[2] - FW) / bw)]
            for side, c in cuts:
                if TXT_CUT < c < 1 - TXT_CUT:
                    bad('text cut by the frame edge', f'text {nm} is cut by the {side} frame edge by {c * 100:.0f} % ({where}) — fully in frame, out of frame '
                        f'or data-cut-ok="<why>"', t['s'] + side)
            if hit < TXT_CLIP and round((1 - hit) * t.get('n', 0)) >= 2 and not t.get('fb'):  # fb — letters by the line box (a sheet in 3D): points miss  # two glyphs or more off the text — a cut, not a missed point
                bad('text cut by its box', f'text {nm} is visible for {hit * 100:.0f} % of its letters: cut by the box of its prop (clip) ({where})', t['s'])
        a = ((t.get('rot', 0) + 180) % 360) - 180
        if abs(a) > TXT_ROT and t.get('sq', 1) >= TXT_SQ:  # the direction of a squeezed text is not measured — it is "squeezed"
            bad('text rotated', f'text {nm} is rotated by {a:.0f}° ({where}) — a line no steeper than {TXT_ROT}° (no vertical or upside-down text)', t['s'])
        if t.get('sq', 1) < TXT_SQ:
            bad('text squeezed', f'text {nm} is squeezed {1 / max(0.01, t["sq"]):.1f}× along an axis ({where}) — a sign at a steep angle is not drawn (production rule 7)', t['s'])
        if t.get('plate') and t.get('pa') is not None and t['pa'] <= TXT_PLATE and not t.get('fb'):  # fb: the sign box by CTM is wrong too
            sp = q_outside(q, t['plate']) / ih
            if sp > TXT_SPILL:
                bad('text out of its sign', f'letters of {nm} stick out of their sign by {sp * 100:.0f} % of the letter height (sign {[round(v) for v in qbox(t["plate"])]}, {where})', t['s'])


def text_passing(journal: list) -> dict:
    """Texts of the shot that leave over the top of the frame for good while the camera moves (a ride down a sheet): they pass the case
    bar on the way, which is not an error. The document header (the largest text at the start of the shot, from 1.25 × the median size)
    is not one of them: the frame holds it."""
    out = {}
    by = {}
    for j in journal:
        by.setdefault(j['shot'], []).append(j)
    for sid, js in by.items():
        js = sorted(js, key=lambda x: x['frame'])
        first, last = js[0].get('texts') or [], js[-1].get('texts') or []
        px = sorted(t['px'] for t in first if t.get('ink'))
        med = px[len(px) // 2] if px else 0
        title = {t['s'] for t in first if med and t['px'] >= 1.25 * med and t['px'] == px[-1]}
        below = {t['s'] for t in last if t.get('ink') and qbox(t['ink'])[3] > BAR_H + 2}
        seen = {t['s'] for j in js for t in j.get('texts') or []}
        out[sid] = {n for n in seen if n not in below and n not in title}
    return out


def continuity_checks(tl: dict, scenes: list) -> list:
    """Continuity across a cut: a day ambience at night; a "hard switch" in the script — without a dip at the joint; in the same static
    view a figure at the cut changes side or the prop in its hands; a look held by a figure is reset after an insert without people."""
    out = []
    sh = tl['shots']
    tm = {sc['id']: sc.get('time') for sc in scenes}
    err = lambda s, rule, msg: out.append({'shot': s['id'], 'rule': rule, 'level': 'error', 't': round(s['start'], 2), 'msg': msg})
    for s in sh:
        t = tm.get(s['scene']) or ''
        if re.match(r'^\d{1,2}:\d{2}$', t) and s.get('bed') and re.search(r'_day$', s['bed']):
            h = int(t.split(':')[0])
            if h >= 22 or h < 5:
                err(s, 'day ambience at night', f'scene {s["scene"]} is in {t}, but the ambience "{s["bed"]}" is a day one: a night ambience for the place (script SFX or the place ambience)')
    for a, b in zip(sh, sh[1:]):
        txt = f'{b.get("on_screen", "")} {b.get("camera", "")}'
        if re.search(r'\bhard (switch|cut)\b|\bsmash cut\b', txt, re.I) and (b.get('dipIn') or a.get('dipOut')) and not re.search(r'\bblack\b', a.get('on_screen', ''), re.I):
            err(b, 'hard cut with a dip', 'the shot line says "hard switch / hard cut", but the joint goes through a dip — staging.json "cut_in": "<why>"')
        if a['scene'] == b['scene'] and a.get('kit') == b.get('kit') and a.get('view') == b.get('view') and a.get('move') == 'static' and b.get('move') == 'static':
            for ca in a.get('cast') or []:
                cb = next((c for c in b.get('cast') or [] if c['who'] == ca['who']), None)
                if not cb or cb.get('cut'):
                    continue
                if (ca.get('facing') or 'front') != (cb.get('facing') or 'front') or (ca.get('hold') or None) != (cb.get('hold') or None):
                    err(b, 'figure jump at a cut in the same view', f'{cb["who"]}: the same view "{b.get("view")}", but at the cut another side or another prop in the hands '
                        f'({ca.get("facing")}/{ca.get("hold")} → {cb.get("facing")}/{cb.get("hold")}) — another view or a move in the frame')
    for a, m, b in zip(sh, sh[1:], sh[2:]):
        if not (a['scene'] == m['scene'] == b['scene']) or (m.get('cast') or []):
            continue
        for ca in a.get('cast') or []:
            cb = next((c for c in b.get('cast') or [] if c['who'] == ca['who']), None)
            if not cb or (cb.get('facing') or 'front') == 'back':
                continue  # from behind the look is not visible
            held = [e for e in (a.get('stage') or {}).get('events', []) if e['do'] == 'look' and e.get('who') == ca['who'] and e.get('stay') is True]
            if not held:
                continue
            dur = b['end'] - b['start']
            to = held[-1].get('to')
            if cb.get('gaze') == to:
                continue  # the default look of the shot is the same (cast gaze)
            new = [e for e in (b.get('stage') or {}).get('events', []) if e['do'] == 'look' and e.get('who') == ca['who'] and e['t0'] <= 0.1 * dur]
            if not new:
                err(b, 'look reset by an insert', f'{ca["who"]} ended {a["id"]} looking at "{held[-1].get("to")}", after the insert {m["id"]} without people — the default look '
                    f'from the first frame: a look event at the shot start (incl. "in": 0) or the same look')
    return out


SLOW_PASS = 0.6  # a text leaves over the top of the frame while the camera moves and passes the title bar longer than this, s — "stands halved under the bar"


def slow_pass_checks(tl: dict, journal: list) -> list:
    """A text slides under the title bar slowly while the camera moves (a sticker and a header halved under a semi-transparent bar for
    3–5 s): text_passing lets leaving lines pass, but a pass longer than SLOW_PASS is an error. Speed — from the last two journal frames
    where the text is in frame and moves up; pass time — (title bar + letter height) / speed."""
    fps = tl['fps']
    passing = text_passing(journal)
    by, out = {}, []
    for j in journal:
        by.setdefault(j['shot'], []).append(j)
    for sid, js in by.items():
        js = sorted(js, key=lambda x: x['frame'])
        if not any(j.get('bar') for j in js):
            continue  # the shot has no title bar (a framed insert) — texts leave over the edge, not under the bar
        for name in sorted(passing.get(sid, ())):
            pts = []
            for j in js:
                for t in j.get('texts') or []:
                    if t['s'] == name and t.get('ink') and t.get('px', 0) >= PX_BAR and not t.get('ok'):
                        pts.append((j['frame'] / fps, qbox(t['ink'])))
                        break
            ups = [(a, b) for a, b in zip(pts, pts[1:]) if b[0] > a[0] and b[1][1] < a[1][1] - 1]
            if not ups:
                continue
            (t1, b1), (t2, b2) = ups[-1]
            v = (b1[1] - b2[1]) / (t2 - t1)
            h = max(1.0, b2[3] - b2[1])
            if b2[1] > BAR_H + 4 * h + 4 * v * (1 / fps) and b2[1] > BAR_H + 0.75 * v:
                continue  # in the last frame the text is still far from the title bar: its path was not measured further
            dur = (BAR_H + h) / max(v, 1e-6)
            if dur > SLOW_PASS:
                out.append({'shot': sid, 'rule': 'text long under the title bar', 'level': 'error', 't': round(t2, 2),
                            'msg': f'text "{name}" leaves over the top of the frame under the title bar for {dur:.1f} s (speed {v:.0f} px/s, letters {h:.0f} px) — '
                                   f'frame it so that what leaves goes down or sideways (push-in from the title bar edge), or cut'})
    return out


def card_slots_free(rect: list, heads: list) -> list:
    """Card places (lib/chapter/Chapter.tsx CARD_POS: top, bottom, tl, tr, bl, br) where the card covers no head during the whole shot.
    The card does not move by itself: the check only names the free places for staging.json → cards: at. heads — head rectangles over
    all journal frames of the shot."""
    w, h = rect[2] - rect[0], rect[3] - rect[1]
    free = []
    for at in ('top', 'bottom', 'tl', 'tr', 'bl', 'br'):
        mid = at in ('top', 'bottom')
        cw, ch = (w, h) if mid or w <= 760 else (760, h * -(-w // 760))  # in a corner a card is no wider than 760 px: the line wraps, the card gets taller
        x = (FW - cw) / 2 if mid else 60 if at in ('tl', 'bl') else FW - 60 - cw
        y = {'top': BAR_H + 60, 'tl': BAR_H + 60, 'tr': BAR_H + 130}.get(at, FH - (60 if at == 'bottom' else 70) - ch)
        if not any(inter([x, y, x + cw, y + ch], [hr[0] + 4, hr[1] - 14, hr[2] - 4, hr[3]]) > 0 for hr in heads):
            free.append(at)
    return free


def layout_checks(tl: dict, journal: list) -> list:
    """Layout rules by the frame journal. → [{'shot', 'rule', 'msg', 'level', 't'}]."""
    fps = tl['fps']
    shots = {s['id']: s for s in tl['shots']}
    frame = [0, 0, FW, FH]
    heads_of = {}  # shot → heads over all journal frames (for the free card place hint)
    for j in journal:
        heads_of.setdefault(j['shot'], []).extend(h['rect'] for h in j.get('heads', []) if inter(h['rect'], frame) > 0.5 * area(h['rect']) and area(h['rect']) > 900)
    out, seen = [], set()
    reads = {}  # (shot, text id) → best visibility over the frames of the shot
    tacc = {}  # (shot, text rule) → first frame and texts
    passing = text_passing(journal)

    def bad(j, rule, msg, key):
        if (j['shot'], rule, key) in seen:
            return
        seen.add((j['shot'], rule, key))
        out.append({'shot': j['shot'], 'rule': rule, 'level': 'error', 't': round(j['frame'] / fps, 2), 'msg': msg})

    for j in journal:
        s = shots[j['shot']]
        why = j.get('why', [])
        # while the camera moves (push-in, a ride over paper — paper kits move the camera always) lines pass the edge: edges and the case
        # bar are checked at rest — at the start and end of the shot
        rest = any(w in ('rest0', 'rest1') for w in why) if (s['move'] != 'static' or s.get('drift')) else True
        lt_ = j['frame'] / fps - s['start']
        if any(e['t0'] - 0.05 <= lt_ <= e['t1'] + 0.05 for e in s.get('stage', {}).get('events', []) if e['do'].startswith(OBJ_MOVES)):
            rest = False  # a sheet slides in, opens: texts on it pass the edge during the event — edges are checked at rest
        bar = j['bar'][0] if j.get('bar') else None
        heads = [h for h in j.get('heads', []) if inter(h['rect'], frame) > 0.5 * area(h['rect']) and area(h['rect']) > 900]
        # text card on a figure's head
        for c in j.get('cards', []):
            for h in heads:
                hr = h['rect']
                grown = [hr[0] + 4, hr[1] - 14, hr[2] - 4, hr[3]]
                if inter(c['rect'], grown) > 0:
                    free = card_slots_free(c['rect'], heads_of[j['shot']])
                    bad(j, 'card on a head', f'card "{c["text"]}" lies on the head of {h["who"]} (card {[round(v) for v in c["rect"]]}, head {[round(v) for v in hr]}) — '
                        f'change the card place (staging.json → cards: at) or the framing; ' +
                        (f'free of heads for the whole shot: at {", ".join(free)}' if free else 'no place is free of heads for the whole shot — change the framing or the card moment (on)'), h['who'])
            if bar and inter(c['rect'], bar) > 0:
                bad(j, 'card under the title bar', f'card "{c["text"]}" goes under the title bar', c['text'])
        # a document line cut by the title bar or by the frame edge in height — at rest
        lt_ = j.get('lineText') or []
        for li, r in enumerate(j.get('lines', [])):
            if j.get('texts') is not None and li < len(lt_) and lt_[li]:
                continue  # the line is the text itself: the text rules check it (text_rules)
            h, w = r[3] - r[1], r[2] - r[0]
            if h < 14 or w < 14 or (w < 0.3 * h and w < 28) or r[2] < 40 or r[0] > FW - 40:
                continue  # small text or text edge-on to the camera — a strip, nobody reads it
            if bar:
                cut = BAR_H - r[1]
                if rest and cut > 0.22 * h and r[3] > 6:
                    bad(j, 'line under the title bar', f'a document line is under the title bar by {min(1.0, cut / h) * 100:.0f} % of its height (line {[round(v) for v in r]}) — '
                        f'keep the line fully below the bar or out of frame', 'p')
            elif rest and 0.22 * h < -r[1] < 0.95 * h:
                bad(j, 'line cut', f'a document line is cut by the top edge by {-r[1] / h * 100:.0f} % of its height (line {[round(v) for v in r]})', 't')
            if rest and 0.22 * h < r[3] - FH < 0.95 * h:
                bad(j, 'line cut', f'a document line is cut by the bottom edge by {(r[3] - FH) / h * 100:.0f} % of its height (line {[round(v) for v in r]}) — '
                    f'keep the line fully in frame or out of it', 'b')
        text_rules(j, s, bar, rest, tacc, passing.get(j['shot'], set()))
        # required texts of the shot: fully in frame, not under the title bar, not covered by a prop
        for r in j.get('reads', []):
            rc = r['rect']
            a = area(rc)
            if a < 30:
                continue
            vis = inter(rc, [0, BAR_H if bar else 0, FW, FH]) / a
            ok = vis > 0.97 and r.get('occ', 0) < 0.18 and r.get('n', 0) > 0
            key = (j['shot'], r['id'])
            cur = reads.get(key)
            score = vis * (1 - r.get('occ', 0)) if r.get('n', 0) > 0 else 0
            if cur is None or score > cur['score']:
                reads[key] = {'score': score, 'ok': ok, 'vis': vis, 'occ': r.get('occ', 0), 'by': r.get('by', ''), 'rect': rc, 'j': j}
        # a figure stands inside a prop
        for h in j.get('hits', []):
            bad(j, 'path through a prop', f'{h["who"]} stands inside the prop "{h["obj"]}" — the figure path goes around props', h['who'] + h['obj'])
        # step and figure
        figs = {f['who']: f for f in j.get('figs', [])}
        for w in why:
            if w.startswith('step:') or w.startswith('mute:'):
                who = w.split(':', 1)[1].lower()
                f = figs.get(who)
                vis = f['vis'] if f else 0.0
                if w.startswith('step:') and vis < 0.12:
                    bad(j, 'step of an invisible figure', f'a step of {who} sounds, but the figure is not visible in the frame (visible {vis * 100:.0f} %) — end the path at the frame exit '
                        f'or set an "offscreen" window on the walk event', who + str(j['frame']))
                if w.startswith('mute:') and vis > 0.5:
                    bad(j, 'figure walks without steps', f'steps of {who} are muted by an offscreen window, but the figure is visible in the frame ({vis * 100:.0f} %)', who + str(j['frame']))
    for (sid, rule), v in tacc.items():
        its = list(v['items'].values())
        out.append({'shot': sid, 'rule': rule, 'level': 'error', 't': round(v['t'] / fps, 2),
                    'msg': f'{len(its)} items: ' + '; '.join(its[:6]) + (f'; {len(its) - 6} more' if len(its) > 6 else '')})
    for (sid, rid), v in reads.items():
        if not v['ok']:
            why = []
            if v['vis'] <= 0.97:
                why.append(f'{v["vis"] * 100:.0f} % in frame (cut by the edge or the title bar)')
            if v['occ'] >= 0.18:
                why.append(f'covered by {v["occ"] * 100:.0f} % ({v["by"] or "a prop"})')
            if not why:
                why.append('not visible')
            out.append({'shot': sid, 'rule': 'text not readable', 'level': 'error', 't': round(v['j']['frame'] / fps, 2),
                        'msg': f'text "{rid}" is not fully visible in any checked frame of the shot: {"; ".join(why)}, box {[round(x) for x in v["rect"]]}'})
    return out


# ---------- frame journal: events, figures, props ----------

LOOK_ATTR = 0.04  # the look reached the figure: head turn, gaze or tilt (/15°) change at least by this much
LOOK_PIX = {'front': 0.08, 'back': 0.15}  # head at the look peak: share of pixels of its box (with a shift for sway) changed from the frame
# before the event. Measured: from behind with no visible turn 0.08–0.095; facing with a weak turn 0.049; accepted 0.106 … 0.41
LOOK_SKIN = 0.03  # from behind: the share of light (cheek, ear) in the head box changes at least by this much — the turn is visible (three quarters: 0.06–0.07;
# when only curls moved — 0.002 and 0.006)
LOOK_V = 0.3  # (when less than 20 % of the head pixels change) an up-down look: pupils move little vertically (the webtoon head: gy · 5 units) — without a head tilt it does not read
GEST_MOVE = 0.03  # the gesture pose is drawn: the wrist or the hand edge moved by a share of the figure height
CONT_PIX = 0.02  # repeated gesture: the hand changes between adjacent frames of the hold (share of its box pixels): a frozen phone 0.007, writing 0.12
VIS = 0.3  # visible: share of element points where it is on top


def _png(png_dir, frame):
    if not png_dir:
        return None
    p = Path(png_dir) / f'f_{frame}.png'
    if not p.exists():
        return None
    from PIL import Image
    return np.asarray(Image.open(p).convert('L'), dtype=np.int16)


def _chg(a, b, r, thr=24):
    """Share of pixels of box r (px 1920×1080) changed between frames a and b (960×540)."""
    if a is None or b is None or r is None:
        return None
    k = a.shape[1] / FW
    x0, y0 = max(0, int(r[0] * k)), max(0, int(r[1] * k))
    x1, y1 = min(a.shape[1], int(np.ceil(r[2] * k))), min(a.shape[0], int(np.ceil(r[3] * k)))
    if x1 - x0 < 2 or y1 - y0 < 2:
        return None
    return float((np.abs(a[y0:y1, x0:x1] - b[y0:y1, x0:x1]) > thr).mean())


def _chg_al(a, b, r, thr=24, sh=4):
    """Like _chg, but b is shifted by up to ±sh px (960×540) to the best match: head and body sway from breathing is not a change."""
    if a is None or b is None or r is None:
        return None
    k = a.shape[1] / FW
    x0, y0 = max(sh, int(r[0] * k)), max(sh, int(r[1] * k))
    x1, y1 = min(a.shape[1] - sh, int(np.ceil(r[2] * k))), min(a.shape[0] - sh, int(np.ceil(r[3] * k)))
    if x1 - x0 < 2 or y1 - y0 < 2:
        return None
    ca = a[y0:y1, x0:x1]
    return min(float((np.abs(ca - b[y0 + dy:y1 + dy, x0 + dx:x1 + dx]) > thr).mean()) for dy in range(-sh, sh + 1) for dx in range(-sh, sh + 1))


def _bright(a, b, r, lvl=120):
    """How much light (skin) was added or removed in box r between frames: from behind a head turn is a cheek and an ear out of the hair."""
    if a is None or b is None or r is None:
        return None
    k = a.shape[1] / FW
    x0, y0, x1, y1 = max(0, int(r[0] * k)), max(0, int(r[1] * k)), min(a.shape[1], int(r[2] * k)), min(a.shape[0], int(r[3] * k))
    if x1 - x0 < 2 or y1 - y0 < 2:
        return None
    return abs(float((a[y0:y1, x0:x1] > lvl).mean()) - float((b[y0:y1, x0:x1] > lvl).mean()))


def _union(rs):
    rs = [r for r in rs if r]
    return [min(r[0] for r in rs), min(r[1] for r in rs), max(r[2] for r in rs), max(r[3] for r in rs)] if rs else None


def _grow(r, d):
    return [r[0] - d, r[1] - d, r[2] + d, r[3] + d]


def _vis_hand(j, who=None, acts=None):
    """The visible kit hand (handMark) in a journal frame: the most visible one."""
    best = None
    for h in j.get('hands') or []:
        if acts and not any((h.get('act') or '').startswith(a) for a in acts) and not (who and (h.get('who') or '').lower() == who):
            continue
        if h.get('a', 1) < 0.5 or inter(h['rect'], [0, 0, FW, FH]) < 300:  # the box of an arm with a sleeve goes out of frame — count the part in frame
            continue
        if best is None or h.get('vis', 0) > best.get('vis', 0):
            best = h
    return best


def _fig(j, who):
    return {f['who']: f for f in j.get('figs', [])}.get(who)


def _tipbox(f, fh):
    tips = [[a[2], a[3], a[2], a[3]] for a in (f or {}).get('arms') or []]
    return _grow(_union(tips), 0.07 * fh) if tips else None


def event_checks(tl: dict, journal: list, png_dir=None, calib: list | None = None) -> list:
    """Event without a visible change — an error (production rules 5, 9a). By journal frames at events (layout_jobs → ev_frames):
    - look: figure attributes (turn, gaze, tilt) change from the frame before the event to the peak; the head at the peak changes in pixels
      too (LOOK_PIX): a turn from behind that is not drawn, a look with "pupils in place";
    - gesture: the figure got the gesture (data-pose) and the pose is drawn — the hand moved (GEST_MOVE); a repeated gesture (dial, write,
      count, tap, rail) — the hand changes during the whole hold (a phone frozen at the chest is an error);
    - hand.*, pen.mark: during the event a kit hand (handMark) or the writing figure is visible in the frame (a pen drawing without a hand);
    - door.*, window.*: while the leaf moves a kit hand or the figure who in a gesture is visible at the leaf, if it has a box (a door
      closing by itself). No hand by design — "nohand": "<why>" on the event; a source out of frame — "offscreen": true.
    calib — measurements are written here (threshold tuning)."""
    fps = tl['fps']
    by = {}
    for j in journal:
        for w in j.get('why', []):
            if w.startswith('ev:'):
                _, i, nm = w.split(':', 2)
                by.setdefault((j['shot'], int(i)), {})[nm] = j
    out = []
    for s in tl['shots']:
        evs = s.get('stage', {}).get('events', [])
        for i, e in enumerate(evs):
            fr = by.get((s['id'], i))
            if not fr:
                continue
            do = e['do']
            who = (e.get('who') or '').lower()
            if e.get('carried'):
                continue  # look and gesture from the previous shot (staging.py carry_in): the change happened there

            def err(rule, msg, jj):
                out.append({'shot': s['id'], 'rule': rule, 'level': 'error', 't': round(jj['frame'] / fps, 2), 'msg': msg})

            if do == 'walk' and e.get('at') and fr.get('end'):
                je = fr['end']
                f = _fig(je, who)
                pm = [pp for pp in je.get('props') or [] if pp.get('id') == e['at']]
                if f and f.get('vis', 0) >= 0.15:
                    if not pm:
                        err('path not at the prop', f'walk {e["who"]} → "{e["at"]}": at the end of the path the prop "{e["at"]}" is not in the journal — the kit sets PropMark / propMark with this id', je)
                    elif pm[0].get('rect'):
                        r, (fx, fy) = pm[0]['rect'], f['feet']
                        fh = max(1.0, f['rect'][3] - f['rect'][1])
                        gap = max(r[0] - fx, fx - r[2], 0)
                        if gap > 0.5 * fh or not (r[1] - 0.1 * fh <= fy <= r[3] + 0.3 * fh):
                            err('path not at the prop', f'walk {e["who"]} → "{e["at"]}": at the end of the path the feet are at {[round(fx), round(fy)]}, the prop at {[round(v) for v in r]} — '
                                f'{gap / fh:.1f} heights away (needed ≤ 0.5) — the path ends at the prop', je)
                continue

            if do in ('look', 'gesture'):
                jb, jp = fr.get('before'), fr.get('peak')
                if not jb or not jp:
                    continue
                fb, fp = _fig(jb, who), _fig(jp, who)
                if not fb or not fp or fp.get('vis', 0) < 0.15 or 'turn' not in fp:
                    continue
                pa, pb = _png(png_dir, jb['frame']), _png(png_dir, jp['frame'])
                fh = max(1.0, fp['rect'][3] - fp['rect'][1])
                if do == 'look':
                    attr = max(abs(fp['turn'] - fb['turn']), abs(fp['tilt'] - fb['tilt']) / 15,
                               *[abs(x - y) for x, y in zip(fp.get('gaze', [0, 0]), fb.get('gaze', [0, 0]))])
                    hr = _union([h['rect'] for jj in (jb, jp) for h in jj.get('heads', []) if h['who'] == who])
                    pix = _chg_al(pa, pb, hr)
                    skin = _bright(pa, pb, hr)
                    if fp.get('facing') == 'back' and pix is not None and skin is not None and skin >= LOOK_SKIN:
                        pix = max(pix, LOOK_PIX['back'])  # a cheek appeared from behind the hair or went away — the turn from behind is visible
                    if calib is not None:
                        calib.append({'shot': s['id'], 'do': do, 'who': who, 'to': e.get('to'), 'attr': round(attr, 3), 'pix': None if pix is None else round(pix, 4),
                                      'raw': _chg(pa, pb, hr), 'skin': None if skin is None else round(skin, 3),
                                      'facing': fp.get('facing'), 'fr': [jb['frame'], jp['frame']], 'head': hr})
                    if attr < LOOK_ATTR:
                        err('look without a change', f'look {e["who"]} → {e.get("to")} ({e["t0"]:.2f}–{e["t1"]:.2f} s): the figure did not get the look — head turn, gaze and tilt '
                            f'are the same as before the event (the kit does not pass lookK to Figure)', jp)
                    elif pix is not None and pix < LOOK_PIX.get(fp.get('facing') or 'front', 0.08):
                        lim = LOOK_PIX.get(fp.get('facing') or 'front', 0.08)
                        err('look without a change', f'look {e["who"]} → {e.get("to")} ({e["t0"]:.2f}–{e["t1"]:.2f} s): the head changed by {pix * 100:.1f} % of its pixels '
                            f'at the look peak (needed ≥ {lim * 100:.0f} %) — the turn is not visible{" from behind: the back of the head in three quarters (ear, cheekbone)" if fp.get("facing") == "back" else ""}', jp)
                    else:
                        dgx, dgy = (abs(x - y) for x, y in zip(fp.get('gaze', [0, 0]), fb.get('gaze', [0, 0])))
                        dturn, dtilt = abs(fp['turn'] - fb['turn']), abs(fp['tilt'] - fb['tilt'])
                        if fp.get('facing') != 'back' and dgy >= LOOK_V and dgy >= dgx and dgy >= dturn and dtilt < 3 and (pix is None or pix < 0.2):
                            err('look without a change', f'look {e["who"]} → {e.get("to")} ({e["t0"]:.2f}–{e["t1"]:.2f} s): an up-down look (gaze y {fb["gaze"][1]:.2f} → '
                                f'{fp["gaze"][1]:.2f}) without a head tilt — the pupils move by fractions of a pixel and do not read: tilt the head (headTilt) by the event', jp)
                else:
                    if fp.get('pose') != e.get('pose') or fp.get('pk', 0) < 0.5:
                        err('gesture without a change', f'gesture {e["who"]} "{e.get("pose")}" ({e["t0"]:.2f}–{e["t1"]:.2f} s): the figure did not get the gesture (data-pose '
                            f'"{fp.get("pose")}" {fp.get("pk", 0):.2f}) — the figure is outside StageCtx or the gesture is covered by another one', jp)
                        continue
                    ab, ap = fb.get('arms') or [], fp.get('arms') or []
                    mv = max([max(np.hypot(p[0] - q[0], p[1] - q[1]), np.hypot(p[2] - q[2], p[3] - q[3])) for p, q in zip(ap, ab)] or [0]) / fh
                    pix = _chg_al(pa, pb, _union([_tipbox(fb, fh), _tipbox(fp, fh)]))
                    cont = None
                    if e.get('pose') in CONT_POSES:
                        # each hand separately: the hand of the gesture changes between all adjacent frames of the hold
                        hold = [jb] + [fr[k] for k in ('hold0', 'hold1', 'hold2', 'hold3') if k in fr]
                        ims = [_png(png_dir, jj['frame']) for jj in hold]
                        arms = [(_fig(jj, who) or {}).get('arms') or [] for jj in hold]
                        best = None
                        for a in range(min(len(x) for x in arms) if arms else 0):
                            vals = []
                            for k in range(len(hold) - 1):
                                tb = [[arms[q][a][2], arms[q][a][3], arms[q][a][2], arms[q][a][3]] for q in (k, k + 1)]
                                v = _chg_al(ims[k], ims[k + 1], _grow(_union(tb), 0.07 * fh))
                                if v is not None:
                                    vals.append(v)
                            if vals and (best is None or min(vals) > best):
                                best = min(vals)
                        cont = best
                    if calib is not None:
                        calib.append({'shot': s['id'], 'do': do, 'who': who, 'pose': e.get('pose'), 'move': round(mv, 3), 'pix': None if pix is None else round(pix, 4),
                                      'cont': None if cont is None else round(cont, 4), 'fr': [jb['frame'], jp['frame']]})
                    if mv < GEST_MOVE and e.get('pose') not in CONT_POSES:  # a repeated gesture (writing) starts from the same grip — it shows by the hand motion
                        err('gesture without a change', f'gesture {e["who"]} "{e.get("pose")}" ({e["t0"]:.2f}–{e["t1"]:.2f} s): the pose is not drawn — the hand moved by '
                            f'{mv * 100:.1f} % of the height (needed ≥ {GEST_MOVE * 100:.0f} %): the skeleton (lib/character/body.ts) has no such pose for this view', jp)
                    elif cont is not None and cont < CONT_PIX:
                        err('gesture without a change', f'gesture {e["who"]} "{e.get("pose")}" ({e["t0"]:.2f}–{e["t1"]:.2f} s): the hand froze — between hold frames only '
                            f'{cont * 100:.1f} % of its box changed (needed ≥ {CONT_PIX * 100:.0f} %): dialing, writing, counting are finger motion for the whole gesture', jp)
            elif do.startswith(HAND_ACTS) or do.startswith(LEAF_ACTS):
                if e.get('offscreen') or e.get('nohand'):
                    continue
                leafy = do.startswith(LEAF_ACTS)
                # "by" — what moves the leaf without a hand (a door closer): a valid cause (staging rule 4); if "by" is a hand drawn by the
                # kit, that hand is looked for
                by_ = (e.get('by') or '').lower() if isinstance(e.get('by'), str) else ''
                if leafy and by_ and (re.search(r'door closer|draught|draft|wind|by itself|itself\b', by_) or not re.search(r'\bhands? |\bhand\b|\barm\b|\bpalm|\bfinger', by_)):
                    continue
                run = [fr[k] for k in (('run0.05', 'run0.3', 'run0.5', 'run0.7') if leafy else ('run0.3', 'run0.5', 'run0.7')) if k in fr]
                if not run:
                    continue
                okn, whov = 0, False
                for jj in run:
                    figs = {f['who']: f for f in jj.get('figs', [])}
                    leaf = next((pp for pp in jj.get('props') or [] if pp.get('id') == e.get('obj') and pp.get('rect')), None)
                    near = _grow(leaf['rect'], 0.06 * FH) if leaf else None
                    h = _vis_hand(jj, who, ('door', 'window', 'hand') if leafy else (do, 'hand', 'pen'))
                    if h and h.get('vis', 0) >= 0.25 and (not near or inter(h['rect'], near) > 0):
                        okn += 1
                        continue
                    if leafy:
                        f = figs.get(who)
                        if f and f.get('vis', 0) >= VIS:
                            whov = True
                            tip_ok = not near or any(near[0] <= a[2] <= near[2] and near[1] <= a[3] <= near[3] for a in f.get('arms') or [])
                            if f.get('pose') and f.get('pk', 0) >= 0.5 and tip_ok:
                                okn += 1
                    elif any(f.get('pose') == 'write' and f.get('pk', 0) >= 0.5 and f.get('vis', 0) >= VIS for f in figs.values()):
                        okn += 1
                # a leaf: the hand is on it for the whole motion; a kit hand (pen, finger) — in most frames
                need = len(run) if leafy else (2 if len(run) >= 3 else 1)
                if leafy and isinstance(e.get('hand'), str) and not whov and okn == 0:
                    continue  # "hand": "<why the hand is not visible>" and who is not in frame — the hand is behind the leaf by design; who in frame — look for their hand
                if calib is not None:
                    calib.append({'shot': s['id'], 'do': do, 'who': who, 'ok': okn, 'of': len(run)})
                if okn < need:
                    if leafy:
                        msg = (f'{do} {e.get("obj")} ({e["t0"]:.2f}–{e["t1"]:.2f} s): the leaf moves, but there is no hand at it — ' +
                               (f'{e["who"]} is in frame, but without a gesture (arms hanging)' if whov else 'neither a kit hand (handMark) nor the figure who is in frame') +
                               '; a hand on the leaf — a gesture of who (pull / push, reach) or a kit hand; a source out of frame — "offscreen": true')
                        err('door without a hand', msg, run[0])
                    else:
                        err('event hand not visible', f'{do} ({e["t0"]:.2f}–{e["t1"]:.2f} s): during the event there is no hand in the frame — a pen, a finger, a hand are drawn as a kit hand with the mark '
                            f'handMark("{do}") (lib/staging/journal.tsx)', run[0])
    return out


def figure_checks(tl: dict, journal: list) -> list:
    """The figure view is not the one in the shot cast (cast: front, but drawn from behind — the fear is not visible)."""
    fps = tl['fps']
    shots = {s['id']: s for s in tl['shots']}
    out, seen = [], set()
    for j in journal:
        s = shots[j['shot']]
        if not any(w in ('rest0', 'mid', 'rest1') for w in j.get('why', [])):
            continue
        cast = {c['who'].lower(): c for c in s.get('cast', [])}
        for f in j.get('figs', []):
            c = cast.get(f['who'])
            if not c or not f.get('facing') or f.get('vis', 0) < VIS or (s['id'], f['who']) in seen:
                continue
            if c.get('facing') and f['facing'] != c['facing']:
                seen.add((s['id'], f['who']))
                out.append({'shot': s['id'], 'rule': 'view not as in cast', 'level': 'error', 't': round(j['frame'] / fps, 2),
                            'msg': f'{f["who"]}: the shot cast says facing "{c["facing"]}", but it is drawn "{f["facing"]}" — fix the cast (staging.json) or the kit'})
    return out


def _explains(e: dict, pid: str) -> bool:
    """The event explains a state change of prop pid: the same obj, or the same action without obj (lamp.* for lamp:…)."""
    kind = pid.split(':', 1)[0]
    return e.get('obj') == pid or (not e.get('obj') and e['do'].split('.')[0] == kind)


def prop_checks(tl: dict, journal: list) -> list:
    """Props of a place (PropMark / propMark): a state jump at a cut of a shot of the same scene without an event or "cut"; a prop of the
    place changed between scenes of the same place and preset without an event; needs="fig:<who>" without a visible figure (a torch beam
    without its holder)."""
    fps = tl['fps']
    order = [s['id'] for s in tl['shots']]
    shots = {s['id']: s for s in tl['shots']}
    first, last = {}, {}
    out, seen = [], set()
    for j in sorted(journal, key=lambda x: x['frame']):
        sid = j['shot']
        props = {p['id']: p for p in j.get('props') or [] if p.get('id')}
        if props:
            first.setdefault(sid, (j, props))
            last[sid] = (j, props)
        figs = {f['who']: f for f in j.get('figs', [])}
        for pid, p in props.items():
            nd = p.get('needs') or ''
            if nd.startswith('fig:') and (sid, pid) not in seen:
                f = figs.get(nd[4:].lower())
                if not f or f.get('vis', 0) < 0.12:
                    seen.add((sid, pid))
                    out.append({'shot': sid, 'rule': 'prop without a cause', 'level': 'error', 't': round(j['frame'] / fps, 2),
                                'msg': f'"{pid}" is in frame, but {nd[4:]} is not visible ({(f or {}).get("vis", 0) * 100:.0f} %) — the prop cannot be there without it'})

    def evs(sid):
        return shots[sid].get('stage', {}).get('events', [])

    for a, b in zip(order, order[1:]):
        if shots[a]['scene'] != shots[b]['scene'] or a not in last or b not in first:
            continue
        ja, pa = last[a]
        jb, pb = first[b]
        for pid in sorted(set(pa) & set(pb)):
            if pa[pid]['state'] != pb[pid]['state'] and not any(_explains(e, pid) for e in evs(a) + evs(b) if e['do'] != 'set' or e.get('cut')):
                out.append({'shot': b, 'rule': 'prop jump at a cut', 'level': 'error', 't': round(jb['frame'] / fps, 2),
                            'msg': f'"{pid}": at the end of {a} — "{pa[pid]["state"]}", at the start of {b} — "{pb[pid]["state"]}", no event — add an event or "cut": "<why>"'})
    place = {}
    for sid in order:
        if sid not in first:
            continue
        s = shots[sid]
        key = (s['location'], s['preset'])
        j0, p0 = first[sid]
        for pid, p in p0.items():
            prev = place.get((key, pid))
            if prev and prev[0] != s['scene'] and prev[1] != p['state']:
                lo, hi = order.index(prev[2]), order.index(sid)
                if not any(_explains(e, pid) for x in order[lo:hi + 1] for e in evs(x)):
                    out.append({'shot': sid, 'rule': 'place prop changed', 'level': 'error', 't': round(j0['frame'] / fps, 2),
                                'msg': f'"{pid}" at {s["location"]} ({s["preset"]}): in {prev[2]} — "{prev[1]}", in {sid} — "{p["state"]}", no event in between '
                                       f'(the state of a place lives in the channel kit code; a change — a set event with "cut": "<why>")'})
        jl, pl = last[sid]
        for pid, p in pl.items():
            place[(key, pid)] = (s['scene'], p['state'], sid)
    return out


def pop_checks(tl: dict, journal: list) -> list:
    """Appearing and vanishing within one frame of a kit hand (handMark), a figure and a prop with a box (propMark) away from the frame
    edge and not behind an occluder; a hand or a prop leaving faster than 0.25 s (production rule 3)."""
    fps = tl['fps']
    out, seen = [], set()
    byshot = {}
    for j in journal:
        byshot.setdefault(j['shot'], []).append(j)
    shots = {s['id']: s for s in tl['shots']}

    def items(j):
        d = {}
        for h in j.get('hands') or []:
            # one figure has one hand, whatever the kit calls the action (stamp → the hand leaves); without who — by the action
            k = f'hand {h["who"]}' if h.get('who') else f'hand {h.get("act") or ""}'
            if k not in d or area(h['rect']) > area(d[k]['rect']):
                d[k] = h
        for f in j.get('figs') or []:
            d[f'figure {f["who"]}'] = f
        for p in j.get('props') or []:
            if p.get('rect'):
                d[f'prop {p["id"]}'] = p
        return d

    def edge(r):
        # at the edge: most of the box is already out of frame (the hand leaves over the edge); an arm box with a sleeve over the edge is
        # not yet "at the edge"
        return inter(r, [0, 0, FW, FH]) < 0.4 * max(1.0, area(r))

    def shown(x):
        return x is not None and x.get('a', 1) >= 0.5 and x.get('vis', 0) >= VIS and area(x['rect']) >= 300

    def gone(x):
        return x is None or x.get('a', 1) < 0.1

    for sid, js in byshot.items():
        js = sorted(js, key=lambda x: x['frame'])
        cuts = [shots[sid]['start'] + e['t0'] for e in shots[sid].get('stage', {}).get('events', []) if e['do'] == 'cut']
        its = [(j, items(j)) for j in js]
        keys = sorted({k for _, d in its for k in d})
        for k in keys:
            for (ja, da), (jb, db) in zip(its, its[1:]):
                n = jb['frame'] - ja['frame']
                if n > 7 or any(abs(c - jb['frame'] / fps) < 0.12 for c in cuts):
                    continue
                xa, xb = da.get(k), db.get(k)
                for x, y, what, jj in ((xa, xb, 'vanished', ja), (xb, xa, 'appeared', jb)):
                    if not (shown(x) and gone(y)) or edge(x['rect']) or (sid, k, what) in seen:
                        continue
                    if n > 1 and (what == 'appeared' or not k.startswith(('hand', 'prop'))):
                        continue  # faster than 0.25 s — only a hand or a prop leaving; within one frame — everything
                    seen.add((sid, k, what))
                    rule = 'appearing within one frame' if what == 'appeared' else 'vanishing within one frame' if n == 1 else 'vanishing faster than 0.25 s'
                    out.append({'shot': sid, 'rule': rule, 'level': 'error', 't': round(jj['frame'] / fps, 2),
                                'msg': f'{k} {what} within {n} frame{"" if n == 1 else "s" if n < 5 else "s"} away from the edge and not behind an occluder (box {[round(v) for v in x["rect"]]}) — '
                                       f'it enters and leaves by motion or by shrinking over 0.25 s or longer'})
    return out


# ---------- sound: ambience at a cut, phone band ----------

def decode_mono(path: Path, sr=8000, start=None, dur=None, af=None) -> np.ndarray:
    cmd = ['ffmpeg', '-v', 'error'] + (['-ss', f'{start:.3f}'] if start is not None else []) + (['-t', f'{dur:.3f}'] if dur is not None else [])
    cmd += ['-i', str(path)] + (['-af', af] if af else []) + ['-ac', '1', '-ar', str(sr), '-f', 'f32le', '-']
    return np.frombuffer(subprocess.run(cmd, capture_output=True, check=True).stdout, np.float32)


def bed_checks(tl: dict, wd: Path) -> list:
    """Ambience dropout at a cut: the level of the ambience track (audio/amb.wav) in a ±0.45 s window around each cut does not drop more than
    7 dB below the quieter of the neighbours (production rule 13: the bed must not dip to near zero at cuts)."""
    p = wd / 'audio' / 'amb.wav'
    if not p.exists():
        return []
    sr = 8000
    x = decode_mono(p, sr)
    out = []
    shots = tl['shots']

    def db(a, b):
        seg = x[max(0, int(a * sr)):max(0, int(b * sr))]
        return 20 * np.log10(np.sqrt(np.mean(seg ** 2)) + 1e-9) if len(seg) else -180.0

    for a, b in zip(shots, shots[1:]):
        if not a.get('bed') or not b.get('bed'):
            continue
        t = b['start']
        left, right = db(t - 1.5, t - 0.6), db(t + 0.6, t + 1.5)
        lo = min(db(t + k * 0.05, t + k * 0.05 + 0.05) for k in range(-9, 9))
        ref = min(left, right)
        if lo < ref - 7 and ref > -70:
            out.append({'shot': b['id'], 'rule': 'ambience dropout at a cut', 'level': 'error', 't': round(t, 2),
                        'msg': f'the ambience at the cut {a["id"]} → {b["id"]} drops to {lo:.0f} dB against {ref:.0f} dB of the neighbours ({a["bed"]} → {b["bed"]})'})
    return out


def band_checks(tl: dict, wd: Path, voices: dict) -> list:
    """Voice processing with a set band (voices.json → voice_suffix.effects.<effect>.band: [from, to, share]): after the filter at least
    the given share of energy is in the band. A phone voice must not sound like a voice in the room."""
    fx = voices.get('voice_suffix', {}).get('effects', {})
    out = []
    for ln in tl['lines']:
        e = fx.get(ln.get('effect') or '')
        if not e or not e.get('band') or not ln.get('file'):
            continue
        lo, hi, share = e['band']
        p = wd / 'voice' / ln['file']
        if not p.exists():
            continue
        sr = 16000
        x = decode_mono(p, sr, af=e['af'])
        if len(x) < sr // 4:
            continue
        sp = np.abs(np.fft.rfft(x * np.hanning(len(x)))) ** 2
        fr = np.fft.rfftfreq(len(x), 1 / sr)
        got = float(sp[(fr >= lo) & (fr <= hi)].sum() / (sp[fr >= 40].sum() + 1e-12))
        if got < share:
            low = float(sp[(fr >= 40) & (fr < lo)].sum() / (sp[fr >= 40].sum() + 1e-12))
            out.append({'shot': ln['shot'], 'rule': 'voice not in band', 'level': 'error', 't': ln['start'],
                        'msg': f'{ln["id"]} ({ln["effect"]}): in the {lo}–{hi} Hz band {got * 100:.0f} % of the energy (needed ≥ {share * 100:.0f} %), below {lo} Hz — {low * 100:.0f} %'})
    return out


LOUD_DB = 6.0  # a line quieter than the median of the chapter lines by more than this, dB — "line quieter than its neighbours"


def loud_checks(tl: dict, wd: Path, voices: dict) -> list:
    """A line in the speech track (audio/speech.wav — after voice processing) is quieter than the median of the chapter lines by more than
    LOUD_DB: the level is taken over the loud half of 50 ms frames (sounding speech, no pauses). A processing with chorus and echo can drop
    the level by 10 dB when loudness is normalised before the filter. Lines with a voice effect marked "quiet": true in voices.json (a
    voice through a door, a phone) are quieter and duller by design and are skipped."""
    p = wd / 'audio' / 'speech.wav'
    if not p.exists():
        return []
    fx = {**voices.get('effects', {}), **voices.get('voice_suffix', {}).get('effects', {})}
    quiet = {k for k, e in fx.items() if e.get('quiet')}
    sr = 16000
    x = decode_mono(p, sr)
    fr = int(0.05 * sr)
    lv = []
    for ln in tl['lines']:
        if not ln.get('file') or (ln.get('effect') or '') in quiet:
            continue
        seg = x[int(ln['start'] * sr):int(ln['end'] * sr)]
        n = len(seg) // fr
        if n < 4:
            continue
        e = np.sort(np.mean(seg[:n * fr].reshape(n, fr) ** 2, axis=1))[::-1]
        lv.append((ln, 10 * np.log10(np.mean(e[:max(2, n // 2)]) + 1e-12)))
    if len(lv) < 5:
        return []
    med = float(np.median([v for _, v in lv]))
    return [{'shot': ln['shot'], 'rule': 'line quieter than its neighbours', 'level': 'error', 't': ln['start'],
             'msg': f'{ln["id"]} ({ln["speaker"]}{", " + ln["effect"] if ln.get("effect") else ""}): {v:.1f} dB against a line median of {med:.1f} dB — '
                    f'quieter by {med - v:.1f} dB (allowed {LOUD_DB:.0f}): loudness after voice processing (voices.json → effects → norm_db)'}
            for ln, v in lv if v < med - LOUD_DB]


# ---------- kit code: motion timing — only by events ----------

LINT = re.compile(r'\bu\s*[-/<>]=?\s*0?\.\d|\b0?\.\d+\s*\*\s*dur\b|\blt\s*-\s*\d*\.?\d+\s*\)\s*/|\(u\s*\*\s*\d')
LINT_OK = re.compile(r'//\s*(cam|stage-ok)\b')


def kit_lint(root: Path, kits_dir: Path) -> list:
    """Motion timing by shot fractions in kit code (u − 0.42, 0.2 · dur, (lt − 0.3) / …): motion and sound must come from an event of the
    staging layer (beat / lookK / eventOf). A camera move over the whole shot and an insert fading in are marked "// cam: …", "// stage-ok: …"."""
    out = []
    for p in sorted(kits_dir.rglob('*.tsx')):
        for n, line in enumerate(p.read_text(encoding='utf-8').splitlines(), 1):
            code = line.split('//')[0]
            if LINT.search(code) and not LINT_OK.search(line):
                out.append({'shot': '—', 'rule': 'timing in kit code', 'level': 'error',
                            'msg': f'{p.relative_to(root).as_posix()}:{n}: {line.strip()[:110]} — motion timing must come from an event (docs/STAGING.md)'})
    return out


def tm(t: float) -> str:
    return f'{int(t // 60)}:{t % 60:05.2f}'


def write(out: Path, tl: dict, data_issues: list, frame_issues: list, rows: list, note: str = '', env: list | None = None):
    out.mkdir(parents=True, exist_ok=True)
    allv = data_issues + frame_issues
    err = [i for i in allv if i['level'] == 'error']
    man = [i for i in allv if i['level'] == 'manual']
    todo = [i for i in allv if i['level'] == 'todo']
    eye = [i for i in allv if i['level'] == 'eye']
    n_ev = sum(len(s.get('stage', {}).get('events', [])) for s in tl['shots'])
    env = env or []
    md = ['# Staging check', '', note, *[f'- **Environment (not staging): the frame journal checks were not run — repeat the run:** {e}' for e in env],
          f'- Events in the chapter: {n_ev}; one-shot sounds: {sum(1 for r in rows if not r["loop"])}',
          f'- Errors: {len(err)}', *[f'  - {i["shot"]}{" · " + tm(i["t"]) if "t" in i else ""} · {i["rule"]}: {i["msg"]}' for i in err],
          f'- Motion by script words, not by an event (not converted): {len(todo)}', *[f'  - {i["shot"]}: {i["msg"]}' for i in todo],
          f'- Manual sound bindings (cue, @) — check by eye: {len(man)}', *[f'  - {i["shot"]}: {i["msg"]}' for i in man],
          f'- VO — check by eye (the frame shows what the narrator says): {len(eye)}', *[f'  - {i["shot"]}: {i["msg"]}' for i in eye]]
    (out / 'report.md').write_text('\n'.join(x for x in md if x is not None) + '\n', encoding='utf-8')
    sm = ['# Sounds and events', '', '"Motion" — share of the frame changing at the sound (0 — the frame is still; "—" — frames were not checked).', '',
          '| Time | Sound | Shot | Event | Motion, % | Note |', '|---|---|---|---|---|---|']
    for r in rows:
        note2 = f'until {tm(r["end"])}' if r['loop'] and r['end'] else (r['manual'] or '') + (' · out of frame' if r['offscreen'] else '')
        sm.append(f'| {tm(r["t"])} | {r["id"]}{" ×" + str(r["n"]) if r["n"] > 1 else ""} | {r["shot"]} | {r["event"]} | '
                  f'{"—" if r["motion"] is None else format(r["motion"] * 100, ".2f")} | {note2} |')
    (out / 'sounds.md').write_text('\n'.join(sm) + '\n', encoding='utf-8')
    return {'errors': len(err), 'todo': len(todo), 'manual': len(man), 'list': [f'{i["shot"]} · {i["rule"]}: {i["msg"]}' for i in err], 'env': env}


def run(tl: dict, wd: Path, ch_cfg: dict, video: Path | None, out: Path | None = None, shots: list | None = None, note: str = '', layout: bool = True,
        ch=None, mix: bool = True, workers: int = 2):
    """ch — Channel (sounds and voices of the channel): without it the ambience and voice band checks are skipped.
    mix=False — without checks on the mixed sound (audio/amb.wav, speech.wav: ambience dropout, quiet line) — the precheck step before render.
    → {'errors', 'todo', 'manual', 'list', 'env'}: env — environment failures (the browser did not start), not staging errors."""
    from tools.pipeline import staging
    from tools.pipeline.common import ROOT
    global FW, FH
    FW, FH = tl.get('width', 1920), tl.get('height', 1080)
    out = out or wd / 'check' / 'staging'
    keep = lambda lst: [i for i in lst if not shots or i['shot'] in shots or i['shot'] == '—']
    data = keep(staging.check_timeline(tl, staging.load_actions(ch_cfg), ch.sfx if ch else None))
    env = []
    journal = run_layout(tl, wd, out, shots, workers=workers, env=env) if layout else None
    figs = {}
    for j in journal or []:
        # boxes of everything that moves by itself: figures, also half-covered ones (in a doorway, behind a leaf)
        figs.setdefault(j['shot'], []).extend([f['rect'] for f in j.get('figs', []) if f.get('vis', 0) >= 0.05])
    fr, motion = frame_checks(tl, video, shots, figs=figs) if video and Path(video).exists() else ([], {})
    sub = {**tl, 'sfx': [x for x in tl['sfx'] if not shots or x['shot'] in shots]}
    rows, snd = sound_rows(sub, motion)
    extra = []
    if layout:
        if journal is None and env:
            pass  # environment, not staging: a separate line in the report (write → env)
        elif journal is None:
            extra.append({'shot': '—', 'rule': 'frame journal', 'level': 'error', 'msg': f'frame journal not collected (tools/stage_layout.mjs) — log {out / "layout.log"}'})
        else:
            extra += layout_checks(tl, journal) + slow_pass_checks(tl, journal)
            if ch is not None:
                # loop without a source: the source can be a PropMark in the frame — the journal check replaces the data-only one
                jl = staging.loop_sources(tl, ch.sfx, [{'shot': j['shot'], 'props': [p.get('id') for p in j.get('props') or []]} for j in journal])
                keepk = {(i['shot'], i['msg']) for i in jl}
                data = [i for i in data if i['rule'] != 'loop without a source' or (i['shot'], i['msg']) in keepk]
            calib = []
            extra += event_checks(tl, journal, out / 'png', calib) + figure_checks(tl, journal) + prop_checks(tl, journal) + pop_checks(tl, journal)
            (out / 'events.json').write_text(json.dumps(calib, ensure_ascii=False, indent=0), encoding='utf-8')  # event measurements — threshold tuning
            if '--keep-png' not in sys.argv:
                for f in (out / 'png').glob('f_*.png'):
                    f.unlink()
    sc_file = wd / 'scenes.json'
    if sc_file.exists():
        extra += keep(continuity_checks(tl, json.loads(sc_file.read_text(encoding='utf-8')).get('scenes', [])))
    if ch is not None:
        extra += keep(band_checks(tl, wd, ch.voices)) + (keep(bed_checks(tl, wd)) + keep(loud_checks(tl, wd, ch.voices)) if mix else [])
        extra += kit_lint(ROOT, ch.dir / 'chapter' / 'kits')
    return write(out, tl, data, fr + snd + extra, rows, note, env)


if __name__ == '__main__':
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
    from tools.pipeline.common import Channel, chapter_video, channel_of_work, load_json  # noqa: E402
    a = sys.argv[1:]
    opt = lambda k, dflt=None: a[a.index(k) + 1] if k in a else dflt
    wd = Path(a[0]).resolve()
    tl = load_json(wd / 'timeline.json')
    chn = Channel(channel_of_work(wd, tl))
    shots = opt('--shots').split(',') if opt('--shots') else None
    video = Path(opt('--video')) if opt('--video') else chapter_video(wd)
    if '--no-video' in a or not video.exists():
        video = None
    res = run(tl, wd, chn.cfg, video, Path(opt('--out')) if opt('--out') else None, shots, note=opt('--note', ''), layout='--no-layout' not in a, ch=chn)
    print(f'errors {res["errors"]}, not converted {res["todo"]}, manual bindings {res["manual"]}')
    for line in res['env']:
        print('  ENVIRONMENT (not staging):', line)
    for line in res['list']:
        print(' ', line)
