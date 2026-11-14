"""Episode subtitles for YouTube — .ytt (srv3, the player format) and a fallback TTML: one track, the speech at the bottom centre, a colour
per speaker, moved off whatever the frame shows there.

python tools/ytt.py channels/<channel>/episodes/s01e01/<lang> [--out <base without extension>] [--no-ttml] [--journal]

Input — the same as `run.py episode` joins into <episode>_<lang>.srt: the chapters ch*/ch*.mp4 of the language folder in order, each with
its timeline.json (cues — pieces of lines ≤ subtitles.max_chars by the character timings of the voice, lines — who speaks), audio/speech.wav
and the frame journal check/staging/layout.json (heads, cards, world texts at the event frames — the check step); --journal first takes
the frame journal at the frames of the pages (check/ytt/layout.json: the start, the middle and the end of every page; the CPU queue,
minutes per chapter). The time of a chapter is shifted by the length of the previous chapters (frames / fps — as the video is joined).
Output — <episode>_<lang>.ytt and .ttml next to the episode video (by default) and a summary line: pages, moved ones.

Config — channel.json → subtitles (min_dur) and subtitles.ytt: {"colors": {"<SPEAKER>": "#RRGGBB"}, "others": "#RRGGBB",
"highlight": "#RRGGBB", "font": "<a font file for measuring the line width>"}; a speaker without a colour — "others" (white by default);
{…} in a cue (subtitles.highlight of timeline.py) — the highlight colour.

Look:
- the font — fs 4 "proportional sans-serif": in the player fs 0 and 4 are '"YouTube Noto", Roboto, Arial, Helvetica, Verdana, "PT Sans
  Caption", sans-serif'; CJK glyphs come from the system font of the viewer (Windows — Malgun Gothic, macOS and iOS — Apple SD Gothic Neo,
  Android and TV — Noto Sans CJK). Other fs lead to monospace (1, 3), serif (2) and decorative (5–7) fallbacks — not used. The line
  width is measured by subtitles.ytt.font (by default public/fonts/NotoSansKR.ttf: slightly wider than Roboto and Arial — the safe side);
- the size — sz 100 (in the player 100 % = video height / 360 × 16: 48 px at 1080p — the default size of the viewer), white #FEFEFE (not
  #FFFFFF: YouTube drops it), the edge et 3 in dark #080808, bold, a line background #080808 at 59 % (an edge alone is not enough: on
  paper and a daylight facade the text did not read);
- a colour per speaker, without a name; {N} — in the highlight colour;
- the place — the bottom centre (ap 7, ah 50, av 96: the bottom of the line at 94 % of the frame). If the page box falls on the place tag,
  a text card, a head or a world text (the frame journal), the page goes up (av down to 84), then to the top under the title bar (ap 1,
  av 5), then to the side (ah 28 / 72 at the bottom and at the top), then higher (av down to 62); with no free place — where the least is
  covered (a world text weighs 10 times less than a face, a card or a tag), with a warning. The next page of the same line stays where
  the previous one was if it is free there (no jumps). ah and av are integers: YouTube does not take fractional ones and puts the window
  at the bottom centre;
- the time — a cue: from the start of its first character − 0.05 s (if the voice in audio/speech.wav started earlier, up to 1 s — from the
  voice: the alignment of a take lags after a pause; not before the end of the previous piece); the end — the end of the cue (+0.2 s after
  the character, timeline.py; a longer voice — up to its end + 0.1 s), a pause to the next page shorter than 0.5 s the page covers (no
  blinking), never shorter than subtitles.min_dur if there is room before the next one; the pages do not overlap (a gap of 0.04 s);
- the wrap: a page is one line until it is wider than 1250 px (at 1080p); a longer one — two lines about equal, only at spaces, better
  after a punctuation mark; a number is not torn from its word ("rule 3"), and (Korean) a determiner from its word (이·그·저·한·두·몇·모든…),
  a bound noun from the word before it (것·수·때·줄·데·뿐·만큼·듯…); a line of one short word is not left.
Check — a sheet of the pages over the frames: tools/ytt_check.py. How the player draws them — tools/ytt_burn.py.
"""
import argparse
import json
import math
import re
import sys
from pathlib import Path
from xml.sax.saxutils import escape

ROOT = Path(__file__).resolve().parent.parent
W, H = 1920, 1080              # the frame of the episode (taken from the first chapter timeline in pages())
SZ = 100                       # sz of a pen: the size 100 % — 48 px at 1080p
BOLD = 1
WHITE = '#FEFEFE'
EDGE = {'et': 3, 'ec': '#080808'}
BOX = ('#080808', 150)          # the line background: 59 % — a light frame (paper, day) does not read without it
BASE = {'ap': 7, 'ah': 50, 'av': 96}
RAISE = range(94, 83, -2)      # av of the lift from the bottom
RAISE2 = range(82, 61, -4)     # a higher lift — the last (the page goes to the middle of the frame)
TOP = {'ap': 1, 'ah': 50, 'av': 5}
SIDES = (28, 72)
GAP = 0.04                     # s between the pages
LEAD = 0.05                    # s: a page before its first character
BRIDGE = 0.5                   # s: a shorter pause the page covers
SNAP = 1.0                     # s: how far a page follows the voice before the first character and after the last one
PAD = 6                        # px gap of the boxes
PX_MIN = 14                    # px: a smaller world text is not read (stage_check.PX_MIN) — it may be covered
BAR_H = 50                     # px: the title bar (lib/hud BAR_H)
# Korean: no break after a determiner, no break before a bound noun
NO_BREAK_AFTER = {'이', '그', '저', '한', '두', '세', '네', '몇', '모든', '어느', '무슨', '어떤', '이런', '그런', '저런', '각', '새', '헌', '첫', '온', '딴'}
BOUND = ('것', '수', '때', '줄', '데', '뿐', '만큼', '듯', '척', '체', '채', '바', '지', '적', '번', '개', '명', '층', '시', '분', '초', '살', '권', '통', '장')
CFG = {'colors': {}, 'others': WHITE, 'highlight': '#FFD24D', 'font': 'public/fonts/NotoSansKR.ttf'}
_FONT = {}


def k1080():
    return H / 1080


def px(sz=SZ):
    return 48.0 * k1080() * max(0.75, 1 + (sz / 100 - 1) / 4)


def max_w():
    return 1250 * k1080()


def font(bold=BOLD):
    from PIL import ImageFont
    if bold not in _FONT:
        f = ImageFont.truetype(str(ROOT / CFG['font']), 100)
        try:
            f.set_variation_by_axes([700 if bold else 400])  # a variable font: the weight of the player pen
        except Exception:
            pass
        _FONT[bold] = f
    return _FONT[bold]


def tw(txt, size=None):
    return font().getlength(txt) * (size or px()) / 100


def line_h(size=None):
    a, d = font().getmetrics()
    return (a + d) * (size or px()) / 100


def plain(t):
    return re.sub(r'[{}]', '', t).strip()


# ---------- the wrap ----------

def glue_ok(left, right):
    """Whether a line may break between the words left | right."""
    if left in NO_BREAK_AFTER or re.fullmatch(r'[\d.,:·]+', right) or re.fullmatch(r'[\d{}.]+[.,]?', right.replace('{', '').replace('}', '')):
        return False
    if any(right == b or re.fullmatch(re.escape(b) + r'[이가을를은는도만에의로와과,.…?!]*', right) for b in BOUND):
        return False
    return True


def wrap(text):
    """The lines of a page: one while it is not wider than max_w(); otherwise two at the best space (equal, better after punctuation)."""
    t = plain(text)
    if tw(t) <= max_w():
        return [text.strip()]
    words = text.split()
    best = None
    for k in range(1, len(words)):
        a, b = ' '.join(words[:k]), ' '.join(words[k:])
        if not glue_ok(plain(words[k - 1]), plain(words[k])) or len(plain(words[k]).strip()) == 0:
            continue
        wa, wb = tw(plain(a)), tw(plain(b))
        cost = abs(wa - wb) + max(0, max(wa, wb) - max_w()) * 4
        if re.search(r'[,.…?!]$', plain(words[k - 1])):
            cost -= 200
        if min(len(plain(a)), len(plain(b))) <= 2:
            cost += 2000
        if best is None or cost < best[0]:
            best = (cost, [a, b])
    return best[1] if best else [text.strip()]


# ---------- a chapter: lines, obstacles ----------

def chapters(ed):
    chs = sorted(p.parent for p in ed.glob('ch*/ch*.mp4'))
    if not chs:
        sys.exit(f'{ed} has no chapters ch*/ch*.mp4')
    return chs


def shot_at(tl, t):
    for s in tl['shots']:
        if s['start'] <= t < s['end']:
            return s
    return tl['shots'][-1]


def place_rect(lines):
    """The place tag (lib/hud PlaceTag): left 44, bottom 150; lines of 36/32 px, bold, letter spacing 1.5 px."""
    from PIL import ImageFont
    f = ImageFont.truetype(str(ROOT / 'public/fonts/NotoSansKR.ttf'), 100)
    try:
        f.set_variation_by_axes([800])
    except Exception:
        pass
    w = max(f.getlength(ln) * (36 if i == 0 else 32) / 100 + 1.5 * len(ln) for i, ln in enumerate(lines))
    h = 10 + 12 + sum((36 if i == 0 else 32) * 1.25 + (4 if i else 0) for i in range(len(lines)))
    return [44, H - 150 - h, 44 + 8 + 18 + w + 24, H - 150]


def card_rect(c):
    """An estimate of the card box (lib/chapter/Chapter.tsx Cards), when there is no frame journal."""
    at = c.get('at') or 'top'
    lines = c['text'].split(' / ')
    size = 30 if len(lines) > 2 or len(c['text']) > 60 else 44
    w = min(1400 if at in ('top', 'bottom') else 760, max(tw(ln, size) for ln in lines) + 78)
    h = len(lines) * size * 1.3 + 24 + 17 + 6
    x0 = {'tl': 60, 'bl': 60, 'tr': W - 60 - w, 'br': W - 60 - w}.get(at, (W - w) / 2)
    y0 = {'top': BAR_H + 60, 'tl': BAR_H + 60, 'tr': BAR_H + 130}.get(at, H - {'bottom': 60}.get(at, 70) - h)
    return [x0, y0, x0 + w, y0 + h]


class Chapter:
    def __init__(self, wd):
        self.tl = json.loads((wd / 'timeline.json').read_text(encoding='utf-8'))
        self.fps = self.tl['fps']
        self.dur = self.tl['frames'] / self.fps
        self.journal = []
        for lp in (wd / 'check' / 'ytt' / 'layout.json', wd / 'check' / 'staging' / 'layout.json'):   # the page frames (--journal), the event frames
            if lp.exists():
                self.journal += json.loads(lp.read_text(encoding='utf-8'))
        if not self.journal:
            print(f'ytt: {wd.name}: no frame journal (check/ytt, check/staging) — heads and world texts are not taken into account', file=sys.stderr)
        self.by_shot = {}
        for j in self.journal:
            self.by_shot.setdefault(j['shot'], []).append(j)
        self.lines = {ln['id']: ln for ln in self.tl['lines']}

    def obstacles(self, a, z):
        """Boxes [x0, y0, x1, y1, what] on the span [a, z] (s of the chapter): the title bar, the stamp, the place tag, the cards, the heads,
        the world texts (reads and texts of the frame journal from PX_MIN): the journal frames within the time of the page (check/ytt —
        ytt.py --journal), without them — all frames of the shot."""
        out = []
        shots = [s for s in self.tl['shots'] if s['start'] < z and s['end'] > a]
        for s in shots:
            if s.get('bar'):
                out.append([0, 0, W, BAR_H + 2, 'title bar'])
            if s.get('stamp'):
                out.append([W - 240, BAR_H, W - 20, BAR_H + 68, 'stamp'])
            if s.get('place'):
                p0 = (s['from'] + round(0.4 * self.fps)) / self.fps
                p1 = min(s['to'] - round(0.2 * self.fps), s['from'] + round(5.6 * self.fps)) / self.fps
                if p0 < z and p1 > a:
                    out.append(place_rect(s['place']) + ['place tag'])
            js = self.by_shot.get(s['id'], [])
            near = [j for j in js if a - 0.3 <= int(j['frame']) / self.fps <= z + 0.3] or js
            for c in s.get('cards') or []:
                c0 = s['start'] + max(0.2, c.get('from') or 0)
                if not (c0 < z):
                    continue
                rs = [jc['rect'] for j in js for jc in j.get('cards') or [] if plain(jc.get('text', ''))[:10] in c['text'].replace(' / ', '')]
                if rs:
                    out.append([min(r[0] for r in rs), min(r[1] for r in rs), max(r[2] for r in rs), max(r[3] for r in rs), 'card'])
                else:
                    r = card_rect(dict(c, at=c.get('at') or ('bottom' if s.get('cardsAt') == 'bottom' else 'top')))
                    out.append(r + ['card'])
            for j in near:
                out += [h['rect'] + [f'head {h["who"]}'] for h in j.get('heads') or []]
                out += [r['rect'] + [f'reads {r["id"]}'] for r in j.get('reads') or []]
                out += [t['rect'] + [f'text "{t["s"][:12]}"'] for t in j.get('texts') or []      # a world text that is read:
                        if t.get('top') and not t.get('hud') and (t.get('px') or 0) >= PX_MIN and len(t.get('s') or '') >= 2]   # from 14 px
        return out


def journal(ed):
    """The frame journal at the frames of the pages (the start, the middle and the end of each): tools/stage_layout.mjs from the code copy
    through the CPU queue → <chapter>/check/ytt/layout.json. The journal of the check step is taken only at the event frames — a camera
    with a push or a drift between them moves texts and faces away; this one is where the subtitles stand. Rebuild it after chapter
    edits."""
    import subprocess
    sys.path.insert(0, str(ROOT))
    from tools import cpu_queue, mirror
    from tools.pipeline.common import node_exe
    pgs = pages(ed)
    m = mirror.sync()
    for wd in chapters(ed):
        tl = json.loads((wd / 'timeline.json').read_text(encoding='utf-8'))
        fps, last = tl['fps'], tl['frames'] - 1
        frames = set()
        for p in pgs:
            if p['ch'] == wd.name:
                a, z = p['t_ch']
                frames |= {min(last, max(0, round(t * fps))) for t in (a + 0.15, (a + z) / 2, z - 0.15)}
        jobs = []
        for f in sorted(frames):
            sh = next((s for s in tl['shots'] if s['from'] <= f < s['to']), tl['shots'][-1])
            jobs.append({'shot': sh['id'], 'frame': f, 'why': ['ytt']})
        out = wd / 'check' / 'ytt'
        out.mkdir(parents=True, exist_ok=True)
        (out / 'layout.json').unlink(missing_ok=True)
        (out / 'layout_jobs.json').write_text(json.dumps({'timeline': str((wd / 'timeline.json').resolve()), 'jobs': jobs,
                                                          'out': str((out / 'layout.json').resolve()), 'workers': 2}), encoding='utf-8')
        with cpu_queue.slot('precheck', f'{ROOT.name} {wd.name} subtitle frame journal', print), open(out / 'layout.log', 'w', encoding='utf-8') as lf:
            r = subprocess.run([node_exe(), str(Path(m) / 'tools' / 'stage_layout.mjs'), str((out / 'layout_jobs.json').resolve())], cwd=m,
                               stdout=lf, stderr=subprocess.STDOUT)
        print(f'frame journal {wd.name}: {len(jobs)} frames, code {r.returncode} → {out / "layout.json"}')


def roles(line):
    sp = (line or {}).get('speaker') or 'NARRATOR'
    return sp, CFG['colors'].get(sp, CFG['others'])


# ---------- pages ----------

def rect_of(rows, pos):
    """The box of a page in frame px at place pos (as the player: 2 % + 0.96 × ah/av, a line padding of 0.25 em on each side)."""
    size = px()
    w = max(tw(plain(r)) for r in rows) + 0.5 * size
    h = len(rows) * line_h()
    x = (2 + 0.96 * pos['ah']) / 100 * W
    y = (2 + 0.96 * pos['av']) / 100 * H
    x0 = {0: x, 1: x - w / 2, 2: x - w}[pos['ap'] % 3]
    y0 = {0: y, 1: y - h / 2, 2: y - h}[pos['ap'] // 3]
    return [x0, y0, x0 + w, y0 + h]


def hits(r, obs):
    return [o for o in obs if r[0] < o[2] - PAD and r[2] > o[0] + PAD and r[1] < o[3] - PAD and r[3] > o[1] + PAD]


def candidates(prev):
    out = [dict(prev)] if prev else []
    out.append(dict(BASE))
    out += [dict(BASE, av=v) for v in RAISE]
    out.append(dict(TOP))
    out += [dict(BASE, ah=h, av=v) for v in (96, 90, 84) for h in SIDES]
    out += [dict(TOP, ah=h) for h in SIDES]
    out += [dict(BASE, av=v) for v in RAISE2]
    return out


def soft(o):
    return o[4].startswith('text')


def place(rows, obs, prev):
    """The place of a page → (place, hard overlaps, world texts under it). Hard boxes (the bar, the tag, the cards, the heads, reads) are
    avoided by all candidates; a world text (texts of the journal) is soft: the page moves off it only slightly up or to the top and only
    to a free place, and on a document sheet filling the frame it stays at the bottom (a page jumping over a document is worse than a
    covered bottom line)."""
    hard = [o for o in obs if not soft(o)]
    fits = lambda c: 20 <= rect_of(rows, c)[0] and rect_of(rows, c)[2] <= W - 20  # noqa: E731
    full = [c for c in candidates(prev) if fits(c)]
    free = lambda c, oo: not hits(rect_of(rows, c), oo)  # noqa: E731
    out = lambda c: (c, hits(rect_of(rows, c), hard), hits(rect_of(rows, c), [o for o in obs if soft(o)]))  # noqa: E731
    start = prev if prev and free(prev, hard) else dict(BASE)
    if free(start, hard):                            # nothing hard at the bottom (or at the previous place): a move only off a text, a soft one
        gentle = ([dict(prev)] if prev else []) + [dict(BASE)] + [dict(BASE, av=v) for v in RAISE] + [dict(TOP)]
        gentle = [c for c in gentle if fits(c) and free(c, hard)]
        c = next((c for c in gentle if free(c, obs)), None)
        return out(c or start)                       # a world text everywhere — stay: jumps over a document are worse
    for oo in (obs, hard):
        c = next((c for c in full if free(c, oo)), None)
        if c:
            return out(c)

    def cost(pos):                                   # nothing free: cover the least
        r = rect_of(rows, pos)
        return sum(max(0, min(r[2], o[2]) - max(r[0], o[0])) * max(0, min(r[3], o[3]) - max(r[1], o[1])) for o in hits(r, hard))
    return out(min(full, key=cost))


def voice(wd):
    """The voice envelope of a chapter (audio/speech.wav): a step of 0.02 s, True — voice (above −35 dBFS: breaths and tails at −37…−45 are
    not a voice); no file — None."""
    import subprocess
    import numpy as np
    f = wd / 'audio' / 'speech.wav'
    if not f.exists():
        return None
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', str(f), '-ac', '1', '-ar', '16000', '-f', 's16le', '-'], capture_output=True, check=True).stdout
    x = np.frombuffer(raw, np.int16).astype(np.float32) / 32768
    n = len(x) // 320
    return 20 * np.log10(np.sqrt(np.mean(x[:n * 320].reshape(n, 320) ** 2, axis=1) + 1e-12)) > -35


def edge(v, t, d):
    """The edge of the voice from moment t: d −1 — the start (backwards), +1 — the end (forwards); pauses up to 0.1 s do not break it;
    silence at t — None."""
    if v is None:
        return None
    k = int(t / 0.02)
    if not (0 <= k < len(v)) or not v[max(0, k - 2):k + 3].any():
        return None
    last, j, miss = k, k, 0
    while 0 <= j < len(v) and miss <= 5:
        if v[j]:
            last, miss = j, 0
        else:
            miss += 1
        j += d
    return (last + (1 if d > 0 else 0)) * 0.02


def configure(wd):
    """The subtitle config of the channel of a chapter (channel.json → subtitles) and the frame size of the episode."""
    global W, H
    sys.path.insert(0, str(ROOT))
    from tools.pipeline.common import channel_of_work
    tl = json.loads((wd / 'timeline.json').read_text(encoding='utf-8'))
    W, H = tl.get('width', 1920), tl.get('height', 1080)
    cfg = json.loads((channel_of_work(wd, tl) / 'pipeline' / 'channel.json').read_text(encoding='utf-8')).get('subtitles', {})
    CFG.update(cfg.get('ytt', {}))
    _FONT.clear()
    return cfg


def pages(ed):
    """The pages of an episode: [{a, z, rows, color, who, line, ch, pos, hit}], the time — of the episode."""
    chs = chapters(ed)
    cfg = configure(chs[0])
    min_dur = cfg.get('min_dur', 0.9)
    out, off = [], 0.0
    for wd in chs:
        ch = Chapter(wd)
        cues = ch.tl['cues']
        v = voice(wd)
        starts = []
        for i, c in enumerate(cues):
            a = c['from'] - LEAD
            on = edge(v, c['from'], -1)
            if on is not None and 0.15 < c['from'] - on <= SNAP:      # the voice before the first character (the alignment of a take lags
                a = on - LEAD                                       # after a pause) — the page with the voice
            if i:
                a = max(a, cues[i - 1]['from'] + 0.3, cues[i - 1]['to'] - 0.15)   # not before the end of the previous piece
            starts.append(max(0.0, a))
        for i, c in enumerate(cues):
            nxt = starts[i + 1] - GAP if i + 1 < len(cues) else ch.dur
            a = starts[i]
            z = c['to']
            off_v = edge(v, c['to'] - 0.05, 1)
            if off_v is not None and 0 < off_v - c['to'] <= SNAP:     # the voice longer than the last character
                z = off_v + 0.1
            if nxt - z < BRIDGE:
                z = nxt
            if z - a < min_dur:
                z = min(nxt, a + min_dur)
            z = min(z, nxt, ch.dur)
            who, col = roles(ch.lines.get(c['line']))
            rows = wrap(c['text'])
            obs = ch.obstacles(a, z)
            last = out[-1] if out and out[-1]['ch'] == wd.name else None
            prev = last['pos'] if last and last['line'] == c['line'] and a + off - last['z'] < 0.3 else None
            pos, bad, under = place(rows, obs, prev)
            out.append(dict(a=a + off, z=z + off, rows=rows, color=col, who=who, line=c['line'], ch=wd.name, pos=pos,
                            hit=[o[4] for o in bad], under=[o[4] for o in under], shot=shot_at(ch.tl, a)['id'], rect=rect_of(rows, pos), obs=obs, t_ch=(a, z)))
        off += ch.dur
    return out


# ---------- writing ----------

def segs_of(row, col):
    """A line → pieces (text, colour): {N} — in the highlight colour."""
    out = []
    for p in re.split(r'(\{[^}]*\})', row):
        if p:
            out.append((p[1:-1], CFG['highlight']) if p.startswith('{') else (p, col))
    return out


def wp_key(pos):
    r = lambda x: int(math.floor(float(x) + 0.5))  # noqa: E731
    return (pos['ap'], r(pos['ah']), r(pos['av']))


def write_ytt(pgs, path):
    """srv3: pen, style and place 0 are dummies (iOS does not take the first pen); line breaks — LF (CRLF breaks iOS)."""
    pens, wps, body = [], [], []

    def pen(**kw):
        a = ' '.join(f'{k}="{v}"' for k, v in kw.items())
        if a not in pens:
            pens.append(a)
        return pens.index(a) + 1
    for p in pgs:
        k = wp_key(p['pos'])
        if k not in wps:
            wps.append(k)
        t, d = int(round(p['a'] * 1000)), int(round((p['z'] - p['a']) * 1000))
        segs = []
        for ri, row in enumerate(p['rows']):
            for txt, col in segs_of(row, p['color']):
                segs.append([pen(sz=SZ, fs=4, b=BOLD, fc=col, fo=254, bc=BOX[0], bo=BOX[1], **EDGE), txt])
            if ri < len(p['rows']) - 1:
                segs[-1][1] += '\n'
        body.append(f'<p t="{t}" d="{d}" wp="{wps.index(k) + 1}" ws="1">' + ''.join(f'<s p="{q}">{escape(x)}</s>' for q, x in segs) + '</p>')
    head = ([f'<pen id="0" sz="{SZ}" fs="4" fc="{WHITE}" fo="254" bo="0"/>'] + [f'<pen id="{i + 1}" {a}/>' for i, a in enumerate(pens)]
            + ['<ws id="0"/>', '<ws id="1" ju="2" pd="0" sd="0"/>', '<wp id="0" ap="7" ah="50" av="100"/>']
            + [f'<wp id="{i + 1}" ap="{ap}" ah="{ah}" av="{av}"/>' for i, (ap, ah, av) in enumerate(wps)])
    path.write_text('<?xml version="1.0" encoding="utf-8"?>\n<timedtext format="3">\n<head>\n' + '\n'.join(head)
                    + '\n</head>\n<body>\n' + '\n'.join(body) + '\n</body>\n</timedtext>\n', encoding='utf-8', newline='\n')


def ttml_time(t):
    ms = int(round(t * 1000))
    return '%02d:%02d:%02d.%03d' % (ms // 3600000, ms // 60000 % 60, ms // 1000 % 60, ms % 1000)


def write_ttml(pgs, path, lang):
    """TTML (a fallback): YouTube takes the style and the place partly (colour, bold, region)."""
    regs, body = [], []
    for p in pgs:
        k = wp_key(p['pos'])
        if k not in regs:
            regs.append(k)
        rows = '<br/>'.join(''.join(f'<span tts:color="{c}" tts:backgroundColor="{BOX[0]}{BOX[1]:02X}">{escape(x)}</span>' for x, c in segs_of(r, p['color'])) for r in p['rows'])
        body.append(f'<p begin="{ttml_time(p["a"])}" end="{ttml_time(p["z"])}" region="r{regs.index(k)}">{rows}</p>')
    rx = []
    for i, (ap, ah, av) in enumerate(regs):
        y = 2 + 0.96 * av
        top = ap < 3
        c = 2 + 0.96 * ah
        half = min(45.0, c, 100 - c)                      # the window inside the frame: narrower for a page moved to the side
        rx.append(f'<region xml:id="r{i}" tts:origin="{c - half:.1f}% {y if top else y - 18:.1f}%" tts:extent="{2 * half:.1f}% 18%" '
                  f'tts:displayAlign="{"before" if top else "after"}" tts:textAlign="center"/>')
    path.write_text('<?xml version="1.0" encoding="utf-8"?>\n<tt xmlns="http://www.w3.org/ns/ttml" xmlns:tts="http://www.w3.org/ns/ttml#styling" '
                    f'xmlns:ttp="http://www.w3.org/ns/ttml#parameter" ttp:timeBase="media" xml:lang="{lang}">\n<head>\n'
                    f'<styling><style xml:id="s" tts:fontWeight="{"bold" if BOLD else "normal"}" tts:textOutline="#080808 6%"/></styling>\n'
                    '<layout>\n' + '\n'.join(rx) + '\n</layout>\n</head>\n<body style="s">\n<div>\n' + '\n'.join(body)
                    + '\n</div>\n</body>\n</tt>\n', encoding='utf-8', newline='\n')


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('dir', help='the language folder of an episode: episodes/<episode>/<lang>')
    ap.add_argument('--out', help='the output base without an extension (default <folder>/<episode>_<lang>)')
    ap.add_argument('--no-ttml', action='store_true')
    ap.add_argument('--journal', action='store_true', help='first take the frame journal at the frames of the pages (CPU, minutes per chapter)')
    a = ap.parse_args()
    ed = Path(a.dir).resolve()
    base = Path(a.out) if a.out else ed / f'{ed.parent.name}_{ed.name}'
    base.parent.mkdir(parents=True, exist_ok=True)
    if a.journal:
        journal(ed)
    pgs = pages(ed)
    write_ytt(pgs, base.with_suffix('.ytt'))
    if not a.no_ttml:
        write_ttml(pgs, base.with_suffix('.ttml'), ed.name)
    moved = [p for p in pgs if wp_key(p['pos']) != wp_key(BASE)]
    bad = [p for p in pgs if p['hit']]
    two = sum(len(p['rows']) > 1 for p in pgs)
    under = sum(bool(p['under']) for p in pgs)
    print(f'pages {len(pgs)}, in two lines {two}, not at the bottom {len(moved)}, without a free place {len(bad)}, on a world text {under} → {base.with_suffix(".ytt")}'
          + ('' if a.no_ttml else ' and .ttml'))
    for p in bad:
        print(f'  {int(p["a"] // 60)}:{p["a"] % 60:05.2f} {p["ch"]} {p["shot"]}: covers {", ".join(sorted(set(p["hit"])))} — "{plain(" ".join(p["rows"]))}"')
    return 0


if __name__ == '__main__':
    sys.exit(main())
