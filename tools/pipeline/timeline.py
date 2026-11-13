"""Step 3: timing. scenes.json + speech → timeline.json: shot times (a shot stretches to fit its speech), lines, subtitles,
staging (view, camera move, who is in the frame and their emotions) from the script words, the staging events of staging.json,
the title bar and its counter, on-screen text, sounds and music inserts.

Staging can be adjusted with staging.json next to the script: {"01.03": {"view": "close", "move": "push", …}}.
"""
import math
import re
from pathlib import Path

from tools.pipeline import staging as stagelib
from tools.pipeline.common import Channel, load_json
from tools.pipeline.staging import step_hits

EMO_WORDS = {
    'calm': 'calm', 'neutral': 'calm', 'focused': 'focused', 'reading': 'calm', 'tired': 'calm', 'bored': 'calm', 'curious': 'calm',
    'wary': 'alert', 'alert': 'alert', 'nervous': 'alert', 'uneasy': 'alert', 'tense': 'alert', 'suspicious': 'alert', 'startled': 'alert',
    'surprised': 'alert', 'listening': 'alert',
    'scared': 'scared', 'afraid': 'scared', 'terrified': 'scared', 'panicked': 'scared', 'frozen': 'scared', 'horrified': 'scared', 'shocked': 'scared',
    'relieved': 'relief', 'relief': 'relief', 'smiles': 'relief', 'smiling': 'relief', 'happy': 'relief',
    'confused': 'confused', 'puzzled': 'confused', 'parted': 'parted', 'angry': 'angry', 'grumbling': 'angry', 'asleep': 'asleep',
    'sleeping': 'asleep',
}
# names of Character faces (lib/character/emotions.ts → EMOTIONS): a staging.json emotion is taken as is, otherwise via EMO_WORDS
FACE_NAMES = set(re.findall(r'^\s+(\w+): \{browY', (Path(__file__).resolve().parents[2] / 'lib' / 'character' / 'emotions.ts').read_text(encoding='utf-8'), re.M))


def names_of(cfg: dict | None) -> dict:
    # channel roles by words: channel.json → names {"<ROLE>": [regex, …]}; lead — the main role (gets the emotion of a clause without a name)
    return (cfg or {}).get('names', {})


def frames(t, fps):
    return int(math.ceil(t * fps - 1e-6))


def stage_view(cam: str, kit: str | None, on: str = '', views: list | None = None) -> str:
    """Kit view. views — the location list from channel.json: [{"cam": regex, "on": regex, "view": name}] — the first match
    (all given keys must match; cam — over the camera line, on — over ON SCREEN). Without views — "close" if the camera line says close, else "wide"."""
    for v in views or []:
        if 'cam' in v and not re.search(v['cam'], cam, re.I):
            continue
        if 'on' in v and not re.search(v['on'], on, re.I):
            continue
        return v['view']
    c = cam.lower()
    return 'close' if 'close' in c else 'wide'


def stage_move(cam: str) -> str:
    c = cam.lower()
    if re.search(r'push[- ]?in|push on|dolly in|creep(s)? in|zoom in|narrowing|slow push', c):
        return 'push'
    if re.search(r'pull[- ]?(back|out)|zoom out', c):
        return 'pull'
    if re.search(r'\bpan\b|pans', c):
        return 'pan'
    if re.search(r'shake|handheld|jolt', c):
        return 'shake'
    return 'static'


def stage_cast(on: str, view: str, cam: str = '', cfg: dict | None = None):
    """Who is in the frame. cfg — channel.json: names {"<ROLE>": [regex…]}, lead — the main role; cast_words [{"re": regex, "who": id,
    "not": regex}] — every match; extras {"prefix": "EXTRA_", "words": […]} — a role without a figure: an id with the prefix written in
    ON SCREEN (EXTRA_CUSTOMER), or, if the channel has no cast_words, the first of the words found ("a customer" → EXTRA_CUSTOMER). A stub
    figure — a role not in cfg.cast (or stub: true)."""
    cfg = cfg or {}
    names = names_of(cfg)
    lead = cfg.get('lead')
    extras = cfg.get('extras', {})
    prefix = extras.get('prefix', 'EXTRA_')
    known = {k for k, v in cfg.get('cast', {}).items() if not v.get('stub')}
    low = on.lower()
    if re.search(r'no one in frame|empty|nobody', low):
        return []
    clauses = [c.strip() for c in re.split(r';', on) if c.strip()]
    cast = {}
    for who, pats in names.items():
        if any(re.search(p, low) for p in pats):
            cast[who] = {'who': who, 'emo': [], 'stub': who != lead}
    for m in re.findall(rf'{re.escape(prefix)}[A-Z_0-9]+', on):
        cast[m] = {'who': m, 'emo': [], 'stub': True}
    both = low + ' ; ' + cam.lower()  # a role named in the camera line ("close on the mother") is in the frame too
    for cw in cfg.get('cast_words', []):
        m = re.search(cw['re'], both)
        if m and not (cw.get('not') and re.search(cw['not'], both)) and cw['who'] not in cast:
            cast[cw['who']] = {'who': cw['who'], 'emo': [], 'stub': True, 'pos': m.start()}
    if not any(k.startswith(prefix) for k in cast) and not cfg.get('cast_words'):
        for w in extras.get('words', []):
            if re.search(rf'\b{w}\b', low) and not re.search(rf"{w}'s voice|voice of (a |the )?{w}", low):
                rid = prefix + w.upper().replace(' ', '_')
                cast[rid] = {'who': rid, 'emo': [], 'stub': True}
                break
    # emotions: by clauses; a clause without a name goes to the main role (lead, if it is in the frame)
    for c in clauses:
        cl = c.lower()
        # names in a clause by position; an emotion goes to the nearest name before it (or the first after)
        pos = []
        for k in cast:
            cw = next((x for x in cfg.get('cast_words', []) if x['who'] == k), None)
            pats = names.get(k, ([cw['re']] if cw else []) + [re.escape(k.lower()), re.escape(k.removeprefix(prefix).lower().replace('_', ' '))])
            for p in pats:
                m = re.search(p, cl)
                if m:
                    pos.append((m.start(), k))
                    break
        pos.sort()
        for m in re.finditer(r'[a-z]+', cl):
            if m.group(0) not in EMO_WORDS:
                continue
            before = [k for i, k in pos if i < m.start()]
            k = before[-1] if before else (pos[0][1] if pos else (lead if lead in cast else next(iter(cast), None)))
            if k:
                cast[k]['emo'].append(EMO_WORDS[m.group(0)])
    facing = 'back' if re.search(r'from behind|back to (the )?camera|his back', low) or view == 'ots' else 'front'
    behind = re.search(r'from behind|behind (him|her|them|the \w+)|over .*shoulder', cam.lower())
    out = []
    for k, v in cast.items():
        v.pop('pos', None)
        emo = []
        for e in v['emo']:
            if not emo or emo[-1] != e:
                emo.append(e)
        v['emo'] = emo or ['calm']
        v['_emo'] = bool(emo)  # the emotion is named by the shot words; otherwise it continues from the previous shot of the scene (build, "emotion across a cut")
        v['facing'] = facing if k == lead else ('back' if behind else 'front')
        if cfg:
            v['stub'] = k not in known
        out.append(v)
    return out


def bed_of(loc: dict, category: str, lib: dict):
    """Default ambience of a place (channel.json → locations.<place>.ambience: id or {preset class: id}); None — the place has no ambience."""
    a = loc.get('ambience')
    if isinstance(a, dict):
        a = a.get(category) or a.get('default')
    e = (lib.get('sounds', {}).get(a) or lib.get('planned', {}).get(a)) if a else None  # planned: not generated yet — silence, listed as missing
    return a if e and not e.get('off') else None


def is_bed(h, lib: dict) -> bool:
    """An ambience bed (not an event sound that runs as a loop, like water): id "amb_…" or an entry with "bed": true."""
    e = lib.get('sounds', {}).get(h) or lib.get('planned', {}).get(h) or {}
    return bool(h) and bool(e.get('loop')) and (h.startswith('amb_') or bool(e.get('bed')))


XFADE = 0.6  # crossfade of the beds of different places at a cut, s (the dip between scenes — 2 × scene_dip)


def bed_segments(shots: list, total: float) -> list:
    """Beds per shot → continuous segments: the same bed is not interrupted at a cut (production rule 13); different ones crossfade over
    XFADE around the cut, without dropping into silence; at silence and at the chapter edges — fade in 0.3 s, fade out 0.5 s."""
    segs = []
    for s in shots:
        b = s.get('bed')
        if segs and segs[-1]['id'] == b and abs(segs[-1]['end'] - s['start']) < 1e-3:
            segs[-1]['end'] = s['end']
        else:
            segs.append({'id': b, 'start': s['start'], 'end': s['end'], 'shot': s['id']})
    out = []
    for i, g in enumerate(segs):
        if not g['id']:
            continue
        prev = segs[i - 1]['id'] if i else None
        nxt = segs[i + 1]['id'] if i + 1 < len(segs) else None
        a = max(0.0, g['start'] - XFADE / 2) if prev else g['start']
        b = min(total, g['end'] + XFADE / 2) if nxt else g['end']
        out.append({'name': g['id'], 'id': g['id'], 'loop': True, 'bed': True, 'start': round(a, 3), 'end': round(b, 3), 'shot': g['shot'],
                    'fade': [XFADE if prev else 0.3, XFADE if nxt else 0.5], 'xfade': [bool(prev), bool(nxt)]})
    return out


def subtitle_chunks(text: str, maxc: int):
    """Splits a line into pieces ≤ maxc: at sentence ends, then at commas, then at the space nearest to the middle."""
    def split(s):
        s = s.strip()
        if len(s) <= maxc:
            return [s]
        for pat in (r'(?<=[.?!…])\s+', r'(?<=,)\s+'):
            parts = [p for p in re.split(pat, s) if p]
            if len(parts) > 1:
                # join neighbours while they fit
                out, cur = [], ''
                for p in parts:
                    if cur and len(cur) + 1 + len(p) > maxc:
                        out.append(cur)
                        cur = p
                    else:
                        cur = f'{cur} {p}'.strip()
                out.append(cur)
                if len(out) > 1:
                    return [y for x in out for y in split(x)]
        sp = [m.start() for m in re.finditer(' ', s)]
        if not sp:
            return [s]
        mid = min(sp, key=lambda i: abs(i - len(s) / 2))
        return split(s[:mid]) + split(s[mid + 1:])
    return split(text)


def highlight(s: str, pats: list | None = None) -> str:
    # channel.json → subtitles.highlight: [[regex, replacement], …]; {…} in a cue is drawn in the accent colour (lib/hud Subtitles)
    for pat, repl in pats or []:
        s = re.sub(pat, repl, s)
    return s


def build(scenes: dict, clips: dict, ch: Channel, staging: dict | None = None, until: float | None = None, only_scenes=None):
    cfg = ch.cfg
    fps = cfg['fps']
    tm = cfg['timing']
    staging = staging or {}
    # the mouth by the aligned syllables as they are, without stretching short syllables (below): staging.json "lip_raw": "<why>" — for a
    # chapter accepted before the stretching, so that a rebuilt timeline gives the mouth of its accepted video (tools/guard.py)
    lip_raw = bool(str(staging.get('lip_raw') or '').strip())
    warns = list(scenes.get('warnings', []))
    shots, lines, cues, sfx, music = [], [], [], [], []
    t = 0.0
    hud = {'bar': None, 'counter': None, 'stamp': cfg.get('hud', {}).get('stamp')}
    loops = {}  # name → index in sfx
    tracks = ch.music['tracks']
    first = True
    lib_act = stagelib.load_actions(cfg)
    stage_issues = []
    sc_list = [s for s in scenes['scenes'] if not only_scenes or s['id'] in only_scenes]
    prev_last = None  # the last shot of the previous scene: a hard cut into the next one removes the dip at its end ("cut_in")
    for sc in sc_list:
        loc = cfg['locations'][sc['location']]
        kit = loc.get('kit')
        sc_shots = []
        state = {}  # prop states of the scene: they carry from shot to shot (staging layer)
        carry, emo_end = {}, {}  # look / gesture and emotion of a figure at the end of the shot — into the next shot of the scene
        scene_bed = {'id': None}  # the ambience named by the script for the scene
        pending_bed = []
        for sh in sc['shots']:
            if until is not None and t >= until:
                break
            ov = staging.get(sh['id'], {})
            view = ov.get('view') or stage_view(sh['camera'], kit, sh['on_screen'], loc.get('views'))
            move = ov.get('move') or stage_move(sh['camera'])
            # speech
            cur = ov.get('lead', tm['lead_in'])  # staging.json "lead": pause before the first line of the shot, s — action before speech ("he dials")
            pl = []
            for i, ln in enumerate(sh['lines']):
                c = clips.get(f'{sh["id"]}#{i}')
                if not c:
                    raise RuntimeError(f'no voice-over for line {sh["id"]}#{i} — run the voice step')
                d = c['offset'] - c['onset']
                pl.append((i, ln, c, cur, d))
                cur += d + tm['gap']
            speech_end = (cur - tm['gap'] + tm['tail']) if pl else 0.0
            dur = max(sh['planned'], speech_end, tm['min_shot'])
            nf = frames(dur, fps)
            start, end = t, t + nf / fps
            dur = end - start
            # staging: shot events (staging.json → events) — prop states, paths, sounds
            st = stagelib.compile_shot(ov, sh['id'], dur, state, lib_act, stage_issues)
            names_in_cam = any(re.search(p, sh['camera'], re.I) for ps in names_of(cfg).values() for p in ps)  # a role named in the camera line ("over Oscar's shoulder") is in the frame
            cast = ov.get('cast') or stage_cast(sh['on_screen'] + ('; ' + sh['camera'] if names_in_cam else ''), view, sh['camera'], cfg)
            known = {k for k, v in cfg.get('cast', {}).items() if not v.get('stub')}
            cast = [{'emo': ['calm'], 'facing': 'front', **c, 'stub': c['who'] not in known} for c in cast]
            # staging.json emotions — a Character face name (lib/character/emotions.ts) or a script word (EMO_WORDS); any other face
            # silently drew as calm — an error
            for cm in cast:
                if not cm.get('emo'):
                    continue
                emo = []
                for e in cm['emo']:
                    if e in FACE_NAMES:
                        emo.append(e)
                    elif e in EMO_WORDS:
                        emo.append(EMO_WORDS[e])
                    else:
                        stage_issues.append({'shot': sh['id'], 'rule': 'emotion not in the dictionary',
                                             'msg': f'{cm["who"]}: "{e}" is not in lib/character/emotions.ts or EMO_WORDS (timeline.py) — the face would be calm'})
                        emo.append('calm')
                cm['emo'] = emo
            for cm in cast:  # the figure path — from walk events
                if cm['who'] in st['paths']:
                    cm.update({k: v for k, v in st['paths'][cm['who']].items() if k != 'offscreen'})
            # emotion across a cut: the same figure in the same scene starts the shot with the emotion it ended the previous one with;
            # not named in the shot — it continues; another one named for a figure of the neighbouring shot — an error without "cut" (cast)
            # / "emo_cut": {"<who>": "<why>"}
            ov_cast = {c.get('who'): c for c in (ov.get('cast') or [])}
            prev_cast = {c['who'] for c in sc_shots[-1]['cast']} if sc_shots else set()
            for cm in cast:
                w = cm['who']
                named = cm.pop('_emo', None)
                named = ('emo' in ov_cast.get(w, {})) if named is None else named
                last = emo_end.get(w)
                if last and not named:
                    cm['emo'] = [last]
                elif last and w in prev_cast and cm.get('emo') and cm['emo'][0] != last:
                    why = ov_cast.get(w, {}).get('cut') or (ov.get('emo_cut') or {}).get(w)
                    if not (why and str(why).strip()):
                        stage_issues.append({'shot': sh['id'], 'rule': 'emotion jumps at a cut',
                                             'msg': f'{w}: ended {sc_shots[-1]["id"]} with "{last}", here "{cm["emo"][0]}" from the first frame — start with "{last}" '
                                                    f'(emo: ["{last}", "{cm["emo"][0]}"]) or "emo_cut": {{"{w}": "<why>"}}'})
                if cm.get('emo'):
                    emo_end[w] = cm['emo'][-1]
            # look and gesture across a cut: a figure starts this shot with what it ended the previous shot of the scene with
            # (a "carried" event, staging.py)
            stagelib.carry_in(st['events'], [c['who'] for c in cast], dur, carry)
            stagelib.carry_out(st['events'], dur, carry, sh['id'])
            # mouth: the one whose line it is speaks in the frame (not a processed copy of the voice) — syllables by character timings, s
            # from the shot start
            for cm in cast:
                talk = [[round(off - c['onset'] + a, 3), round(off - c['onset'] + b, 3)]
                        for i, ln, c, off, d in pl if ln['speaker'] == cm['who'] and not ln.get('effect')
                        for x, a, b in c['chars'] if x.isalnum()]
                # a syllable shorter than 0.1 s — the mouth is open for one frame on a loud word (alignment gives 0.03–0.05 s): the syllable
                # is stretched to 0.1 s, but not past the start of the next one. A chapter with "lip_raw" — the syllables as they are
                for i in range(0 if lip_raw else len(talk)):
                    a0, b0 = talk[i]
                    if b0 - a0 < 0.1:
                        nxt = talk[i + 1][0] - 0.01 if i + 1 < len(talk) else a0 + 0.1
                        talk[i][1] = round(max(b0, min(a0 + 0.1, nxt)), 3)
                    # a syllable before a pause: alignment cuts off a drawn-out vowel — up to 0.3 s from the syllable start, not closer than
                    # 0.08 s to the next one
                    gap = talk[i + 1][0] - talk[i][1] if i + 1 < len(talk) else 1.0
                    if gap > 0.3:
                        lim = talk[i + 1][0] - 0.08 if i + 1 < len(talk) else a0 + 0.3
                        talk[i][1] = round(max(talk[i][1], min(a0 + 0.3, lim)), 3)
                if talk:
                    cm['talk'] = talk
            # lamp flicker and a lamp going out — only shot events (staging.json): timing is not derived from the script words
            flick = st['flicker']
            lamp_off = st['lampOff']
            # interface
            place, cards = None, []
            for it in sh['text']:
                if it['kind'] == 'bar':
                    hud['bar'] = it['title'] or None
                elif it['kind'] == 'counter':
                    hud['counter'] = None if it.get('hidden') else {k: it[k] for k in ('total', 'current', 'crossed')}
                elif it['kind'] == 'stamp':
                    hud['stamp'] = it['text']
                elif it['kind'] == 'place':
                    place = it['lines']
                elif it['kind'] == 'card':
                    cards.append({'label': it['label'], 'text': it['text']})
            if kit is None:
                warns.append(f'{sh["id"]}: location "{sc["location"]}" — a stub (no kit in code)')
            for cm in cast:
                if cm.get('stub'):
                    warns.append(f'{sh["id"]}: {cm["who"]} — a stub figure')
            shot = {
                'id': sh['id'], 'scene': sc['id'], 'start': round(start, 4), 'end': round(end, 4), 'from': frames(start, fps),
                'to': frames(start, fps) + nf, 'location': sc['location'], 'about': loc.get('about', ''), 'kit': kit, 'preset': sc['preset'],
                'category': cfg['presets'][sc['preset']], 'view': view, 'move': move, 'camera': sh['camera'],
                'on_screen': sh['on_screen'], 'cast': cast, 'flicker': flick, 'lampOff': lamp_off,
                'bar': hud['bar'], 'counter': hud['counter'], 'stamp': hud['stamp'], 'place': place, 'cards': cards,
                'speech': [round(start + p[3], 3) for p in pl], 'planned': sh['planned'],
                'stage': {'events': st['events'], 'props': st['props']},
            }
            if loc.get('drift'):  # the kit always moves the camera (papers): for the checks this is a shot with a camera move
                shot['drift'] = True
            # for the "line → event" check (staging.py verb_issues, loop_sources): VO of the English draft, shot exceptions
            if sh.get('vo_src'):
                shot['vo_src'] = sh['vo_src']
            for k in ('verbs_ok', 'offscreen_sfx'):  # {"<phrase>": "<why>"}, {"<sound id>": "<why the source is clear without the frame>"}
                if ov.get(k):
                    shot[k] = ov[k]
            if ov.get('shake'):  # frame shake by design (staging.json: "shake": "<why>") — the static-shot jitter check does not count it
                shot['shake'] = ov['shake']
            if ov.get('cardsAt'):  # text cards at the bottom when at the top they cover a head (staging.json: "cardsAt": "bottom")
                shot['cardsAt'] = ov['cardsAt']
            # place and moment of a card: staging.json "cards": [{"at": "top|bottom|tl|tr|bl|br", "on": "<action or pose of an
            # event>"}] in TEXT order
            for i, co in enumerate(ov.get('cards', [])):
                if i >= len(cards) or not co:
                    continue
                if co.get('at'):
                    cards[i]['at'] = co['at']
                if co.get('on'):
                    e = next((e for e in st['events'] if co['on'] in (e['do'], e.get('pose'), e.get('id'))), None)
                    if e is None:
                        stage_issues.append({'shot': sh['id'], 'rule': 'event', 'msg': f'card {i + 1}: no event "{co["on"]}"'})
                    else:
                        cards[i]['from'] = e['t0']
            if sc_shots:  # the previous shot of the same scene: the kit continues its framing instead of jumping (production rule 1)
                pv = sc_shots[-1]
                shot['prev'] = {'id': pv['id'], 'view': pv['view'], 'kit': pv['kit']}
            if first:
                ep = scenes.get('episode')
                plate = next((it['text'] for it in sh['text'] if it['kind'] == 'episode'), None)
                if plate or scenes.get('chapter') == 1:
                    shot['episodePlate'] = plate or cfg.get('hud', {}).get('episode_plate', 'Episode {ep}').format(ep=ep) if ep else plate
                first = False
            shots.append(shot)
            sc_shots.append(shot)
            pending_bed.append((shot, ov.get('bed') is False))  # staging.json "bed": false — silence in the shot by design
            # lines and subtitles
            for i, ln, c, off, d in pl:
                s0 = start + off
                cs = s0 - c['onset']
                # voice processing: a processed copy of a voice — from parse; a phone voice — staging.json "effects": {"<line number>": "phone"}
                eff = ov.get('effects', {}).get(str(i)) or ln.get('effect')
                lines.append({'id': f'{sh["id"]}#{i}', 'shot': sh['id'], 'speaker': c['speaker'], 'as': ln['speaker'], 'effect': eff,
                              'text': c['text'], 'start': round(s0, 3),
                              'end': round(s0 + d, 3), 'clipStart': round(cs, 3), 'file': c.get('file'), 'estimate': c.get('estimate', False),
                              'lufs': c.get('lufs'), 'target_lufs': c.get('target_lufs', -18)})
                chars = c['chars']
                disp_txt = ''.join(x[0] for x in chars)
                pos = 0
                for chunk in subtitle_chunks(disp_txt, ch.cfg['subtitles']['max_chars']):
                    k = disp_txt.find(chunk, pos)
                    k = pos if k < 0 else k
                    a, b = chars[k], chars[min(len(chars) - 1, k + len(chunk) - 1)]
                    pos = k + len(chunk)
                    cues.append({'from': round(cs + a[1], 3), 'to': round(cs + b[2] + 0.2, 3), 'text': highlight(chunk, ch.cfg['subtitles'].get('highlight')), 'line': f'{sh["id"]}#{i}'})
            # sounds: every script sound → library entries (sfx.json, match); ignore marks are not sounds; a bed (loop on the sound or in
            # the script) runs until the end of the scene or until "(stop)", repeating the name does not restart it
            lib = ch.sfx
            items = []
            # staging.json → "sfx": {"<name>": [shot fractions u…] | null} — the sound of an event lands at the moment of the event in the
            # kit (u — the same shot fraction as in the animation), null — remove the script sound from the shot (production rule 12)
            sfx_ov = ov.get('sfx', {})
            # a script sound that a shot event gives is placed by the event: the SFX line does not duplicate it
            ev_ids = {h for y in st['sfx'] for h in (classify_sfx(y['name'], lib)[1] or [y['name']])}
            src = [x for x in sh['sfx'] if x['name'] not in sfx_ov and not (re.match(r'^steps?$', x['name']) and any(c.get('path') for c in cast))
                   and not (set(classify_sfx(x['name'], lib)[1]) & ev_ids)]
            for name, us in sfx_ov.items():  # legacy format: time without an event — the check will flag "sound without an event"
                for uu in (us or []):
                    src.append({'name': name, 'loop': False, 'stop': False, 'at': round(uu * dur, 3), 'legacy': True})
            for y in st['sfx']:
                src.append({'name': y['name'], 'loop': False, 'stop': False, 'at': y['at'], 'event': y['event'], 'offscreen': y['offscreen']})
            for x in src:
                kind, hits = classify_sfx(x['name'], lib)
                if kind == 'ignore':
                    continue
                for h in (hits or [None]):
                    e = (lib.get('sounds', {}).get(h) or lib.get('planned', {}).get(h) or {}) if h else {}
                    items.append((x, h, bool(x['loop'] or e.get('loop'))))
            free = [it for it in items if not it[2] and not it[0]['stop'] and it[0]['at'] is None]
            for it in items:
                x, h, is_loop = it
                key = h or x['name']
                if x['stop']:
                    if key in loops:
                        sfx[loops.pop(key)]['end'] = round(start + (x['at'] or 0), 3)
                    continue
                if is_loop and (h is None or is_bed(h, lib)):
                    # place ambience: the script names it for the scene; the bed track is built by bed_segments (no gap at a cut)
                    if h is not None:
                        scene_bed['id'] = h
                    continue
                if is_loop:
                    if key in loops:
                        continue
                    loops[key] = len(sfx)
                    sfx.append({'name': x['name'], 'id': h, 'loop': True, 'start': round(start + (x['at'] or 0), 3), 'end': None, 'shot': sh['id']})
                    continue
                # a one-shot sound is placed by a shot event; a script sound without an event goes evenly over the shot and is
                # reported as an error
                at = x['at'] if x['at'] is not None else 0.1 * dur + free.index(it) * 0.8 * dur / max(1, len(free))
                # which event the sound is bound to: a shot event; a rule by a script word (lamp, lunge — the same time as in the kit);
                # time @ in the script and cue — a manual binding; otherwise there is no event — a check error
                label, manual = None, None
                if x.get('event') is not None:
                    e = st['events'][x['event']]
                    label = e['do'] + (f" {e['obj']}" if e.get('obj') else '') + (f" {e['who']}" if e.get('who') else '')
                    manual = e.get('see') if e['do'] == 'cue' else None
                elif x['at'] is not None and not x.get('legacy'):
                    label, manual = '@', 'time @ in the script'
                sfx.append({'name': x['name'], 'id': h, 'loop': False, 'start': round(start + min(at, dur - 0.1), 3), 'end': None, 'shot': sh['id'],
                            'event': label, 'manual': manual, 'offscreen': bool(x.get('offscreen'))})
            # steps: along the figure path from staging.json (cast[].path) — one step per foot contact, the type by shoes (shoe)
            for cm in cast:
                if not cm.get('path'):
                    continue
                # a step on the cut itself would sound in the next shot; inside an offscreen window (the figure is not visible:
                # it went over the edge, round the corner) steps do not sound — the frame journal checks the window against
                # what is visible (tools/stage_layout.mjs)
                mute = st['paths'].get(cm['who'], {}).get('offscreen', [])
                all_hits = [h for h in step_hits(cm['path'], dur) if h < dur - 0.1]
                hits = [h for h in all_hits if not any(a - 1e-3 <= h <= b + 1e-3 for a, b in mute)]
                for e in st['events']:  # muted steps go into the event: the frame journal will check that the figure is not visible at that time
                    if e['do'] == 'walk' and e.get('who') == cm['who']:
                        e['mute'] = [h for h in all_hits if h not in hits and e['t0'] - 1e-3 <= h <= e['t1'] + 1e-3]
                if not hits:
                    continue
                sid = f"step_{cm.get('shoe', 'soft')}"
                sfx.append({'name': sid, 'id': sid, 'loop': False, 'start': round(start + hits[0], 3), 'end': None, 'shot': sh['id'],
                            'hits': [round(start + h, 3) for h in hits], 'who': cm['who'], 'event': f"walk {cm['who']}", 'offscreen': False})
            # music
            for m in sh['music']:
                ln_rng = ch.music['len_range']
                d = min(max(m['dur'] or 6.0, ln_rng[0]), ln_rng[1])
                if m['src']:
                    tr, a0 = m['src']['track'], m['src']['at']
                    mood_id = 'manual'
                else:
                    mood = pick_mood(m['mood'], ch.music['moods'])
                    if not mood:
                        mood = ch.music['moods'][0] if ch.music['moods'] else None
                        if not mood:
                            raise RuntimeError(f'{sh["id"]}: music.json has no moods')
                        warns.append(f'{sh["id"]}: music mood "{m["mood"]}" not found in music.json — took "{mood["id"]}"')
                    tr, mood_id = mood['track'], mood['id']
                    a0 = mood['at'] if mood['anchor'] == 'start' else mood['at'] - d
                if tr not in tracks:
                    raise RuntimeError(f'{sh["id"]}: no track "{tr}" in music.json')
                a0 = max(0.0, min(a0, 60.0 - d))
                music.append({'mood': m['mood'], 'pick': mood_id, 'track': tr, 'src': round(a0, 2), 'dur': d,
                              'start': round(start + m['at'], 3), 'shot': sh['id']})
            t = end
        # loops — until the end of the scene
        for name in list(loops):
            sfx[loops.pop(name)]['end'] = round(t, 3)
        # place ambience: named by the script — for the whole scene, else the default ambience of the
        # place (channel.json → locations.<place>.ambience)
        for shot, no_bed in pending_bed:
            shot['bed'] = None if no_bed else (scene_bed['id'] or bed_of(loc, shot['category'], ch.sfx))
        if sc_shots:
            # joint between scenes — a dip; staging.json "cut_in": "<why>" on the first shot of a scene — a hard cut without a dip
            # (a "hard switch" in the script must not go through black)
            if staging.get(sc_shots[0]['id'], {}).get('cut_in'):
                sc_shots[0]['cutIn'] = staging[sc_shots[0]['id']]['cut_in']
                if prev_last is not None:
                    prev_last.pop('dipOut', None)
            else:
                sc_shots[0]['dipIn'] = cfg['timing']['scene_dip']
            sc_shots[-1]['dipOut'] = cfg['timing']['scene_dip']
            prev_last = sc_shots[-1]
        if until is not None and t >= until:
            break
    # subtitles do not overlap
    cues.sort(key=lambda c: c['from'])
    for a, b in zip(cues, cues[1:]):
        if a['to'] > b['from'] - 0.04:
            a['to'] = round(b['from'] - 0.04, 3)
    if len(music) > ch.music['max_per_chapter']:
        warns.append(f'{len(music)} music inserts — more than {ch.music["max_per_chapter"]} per chapter')
    sfx += bed_segments(shots, frames(t, fps) / fps)
    # ready library files (planned — not generated yet: silence in the mix)
    ready = ch.sfx.get('sounds', {})
    for x in sfx:
        x['lib'] = x['id'] if x['id'] in ready else None
        x['file'] = ready[x['id']]['file'] if x['lib'] else None
    total = frames(t, fps)
    return {'channel': ch.id, 'episode': ch.ep, 'style': cfg.get('style'), 'fps': fps, 'width': cfg['width'], 'height': cfg['height'], 'frames': total, 'duration': round(total / fps, 4),
            'title': scenes.get('title', ''), 'lang': scenes.get('lang'), 'shots': shots, 'lines': lines, 'cues': cues, 'sfx': sfx,
            'music': music, 'warnings': sorted(set(warns), key=warns.index), 'stage_issues': stage_issues}


def pick_mood(text: str, moods):
    low = (text or '').lower()
    best, score = None, 0
    for m in moods:
        for k in m['keys']:
            if re.search(rf'\b{re.escape(k)}\b', low):
                s = len(k)
                if s > score:
                    best, score = m, s
    return best


def classify_sfx(name: str, lib: dict):
    """Script sound → ('ignore' | 'sound' | 'missing', [library entry ids])."""
    low = name.lower()
    if lib.get('ignore') and re.search(lib['ignore'], low):
        return 'ignore', []
    hits = [k for part in ('sounds', 'planned') for k, v in lib.get(part, {}).items() if v.get('match') and not v.get('off') and re.search(v['match'], low)]
    return ('sound' if hits else 'missing'), hits


def load_staging(script: Path):
    p = script.parent / 'staging.json'
    return load_json(p) if p.exists() else {}
