"""Staging layer (docs/STAGING.md): shot events from staging.json → prop states, figure paths and sounds.

One event is one source for both the picture and the sound: the location kit draws the motion from shot.stage (lib/staging/stage.ts),
the sound lands at the same time by the action library (lib/staging/actions.json + channel.json → actions).
A prop state carries from shot to shot of a scene: a jump at a cut is an error unless the event has "cut": "<why>".

Rules of the layer (each one closes a class of defects):
- one progress curve per layer: smooth(time fraction) (lib/staging/stage.ts beat / trackAt). The event sound lands by the PROGRESS fraction
  (sfx: [id, progress fraction, offset s]), not by the time fraction: a door clicks when the leaf is visibly closed, paper rustles when
  the sheet visibly starts moving;
- a prop moves only with a cause: an action with "hand": true (door, window) needs who and their gesture at the start of the motion,
  or "hand": "<why the hand is not visible>", or "by": "<what moves it>";
- cue — only the sound of an out-of-frame source (offscreen) and starting an ambience loop; visible motion is a library action;
- at least two steps per segment: a step and a closing step; no steps sound inside an offscreen window of the path;
- a path must not end inside a prop: checked by the frame journal (tools/stage_layout.mjs);
- the look and gesture a figure ended a shot with (look / gesture with "stay": true or held to the end) carry into the next shot of the
  scene as a "carried" event until a new event of the same figure;
- an action verb of an ON SCREEN / camera line without an event is an error of the check step (verb_issues: the verbs dictionary,
  the subject is a role of the shot).
"""
import math
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))  # run as a file: python tools/pipeline/staging.py verbs …
from tools.pipeline.common import ROOT, load_json  # noqa: E402

# gait constants shared with lib/staging/walk.ts (lib/staging/walk.json): step length, m; acceleration and stop, s; the fewest steps per
# segment (a step and a closing step); steps per second on the steady part for every pace (production rule 4)
WALK = load_json(ROOT / 'lib' / 'staging' / 'walk.json')
STEP_M = WALK['step_m']
RAMP_S = WALK['ramp_s']
STEP_MIN = WALK['step_min']
PACE = {k: tuple(v) for k, v in WALK['pace'].items()}
RESERVED = {'do', 'obj', 'who', 'u', 't', 'dur', 'cut', 'why', 'see', 'sfx', 'from', 'to', 'shoe', 'pace', 'pose', 'offscreen', 'auto', 'hand', 'by', 'id', 'side'}
# sound "end" / "start" (actions.json): the leaf within SEEN of the range from its final value is visibly at rest (at 1.5 % the hit came
# while the edge was still 6–10 px away, at 0.5 % — 2 px)
SEEN = 0.005


def load_actions(cfg: dict) -> dict:
    lib = load_json(ROOT / 'lib' / 'staging' / 'actions.json')
    acts = dict(lib['actions'])
    acts.update(cfg.get('actions', {}))
    # the "line → event" dictionary: channel entries go first — a piece of the line they match is closed for the common ones
    return {'actions': acts, 'verbs': cfg.get('action_verbs', []) + lib['verbs'], 'vo_verbs': lib.get('vo_verbs', []),
            'poses': {**lib.get('poses', {}), **cfg.get('poses', {})}, 'cast_words': cfg.get('cast_words', []), 'cast_pron': cfg.get('cast_pron', {}),
            'names': cfg.get('names', {})}


def ramp_of(T: float) -> float:
    """Share of a segment for acceleration (and the same for the stop)."""
    return min(RAMP_S, T / 3) / T if T > 1e-6 else 1 / 3


def travel(x: float, a: float) -> float:
    """Travelled share of the path at time fraction x: acceleration a, steady part, stop a (lib/staging/walk.ts travel)."""
    x = min(1.0, max(0.0, x))
    k = 1 / (2 * a * (1 - a))
    if x < a:
        return k * x * x
    if x > 1 - a:
        return 1 - k * (1 - x) ** 2
    return (x - a / 2) / (1 - a)


def steps_of(a, b) -> int:
    d = math.hypot(b[0] - a[0], b[1] - a[1])
    return 0 if d < 1e-3 else max(STEP_MIN, round(d / STEP_M))


def smooth(x: float) -> float:
    x = min(1.0, max(0.0, x))
    return x * x * (3 - 2 * x)


def inv_smooth(p: float) -> float:
    """Time fraction of the event at which the progress (smooth) reaches p: the event sound lands by the progress, not by time."""
    p = min(1.0, max(0.0, p))
    lo, hi = 0.0, 1.0
    for _ in range(40):
        mid = (lo + hi) / 2
        if smooth(mid) < p:
            lo = mid
        else:
            hi = mid
    return hi


def step_hits(path: list, dur: float) -> list:
    """Foot contacts on a path [u0, u1, [x0, z0], [x1, z1]]: a whole number of steps per segment, contact k — where travel = k / n. Seconds from the shot start."""
    out = []
    for u0, u1, a, b in path:
        n = steps_of(a, b)
        ra = ramp_of((u1 - u0) * dur)
        for k in range(1, n + 1):
            lo, hi = 0.0, 1.0
            for _ in range(40):
                mid = (lo + hi) / 2
                if travel(mid, ra) < k / n:
                    lo = mid
                else:
                    hi = mid
            out.append(round((u0 + (u1 - u0) * hi) * dur, 3))
    return out


def span(ev: dict, dur: float, act: dict):
    d = ev.get('dur', act.get('dur', 0.0))
    if 'u' in ev:
        u = ev['u']
        t0, t1 = (u[0] * dur, u[1] * dur) if isinstance(u, list) else (u * dur, u * dur + d)
    elif 't' in ev:
        t = ev['t']
        fix = lambda x: dur + x if x < 0 else x
        t0, t1 = (fix(t[0]), fix(t[1])) if isinstance(t, list) else (fix(t), fix(t) + d)
    else:
        t0, t1 = 0.0, d
    return round(max(0.0, min(dur, t0)), 3), round(max(0.0, min(dur, t1)), 3)


def seen_frac(p, ev: dict) -> float:
    """Progress fraction of the event sound. A number — as is; "end" / "start" — the leaf visibly stopped / started: within SEEN of the range
    from the final / initial state value (from / to of the event) — the same for any event length."""
    if not isinstance(p, str):
        return p
    a, b = ev.get('from'), ev.get('to')
    d = abs(b - a) if isinstance(a, (int, float)) and isinstance(b, (int, float)) else 0.0
    e = min(0.5, SEEN / d) if d > 1e-6 else 0.04
    return 1 - e if p == 'end' else e


def hold_k(e: dict, lt: float, tin: float = 0.5, tout: float = 0.5) -> float:
    """Hold of the event 0..1 at lt — like lib/staging/stage.ts hold (entry in, exit out, "stay": true — stays, carried — from the previous shot)."""
    if e.get('carried'):
        return 1.0 if e.get('stay') is True else smooth((e['t1'] - lt) / max(1e-6, e.get('out', tout)))
    ln = max(1e-6, e['t1'] - e['t0'])
    a = smooth((lt - e['t0']) / max(1e-6, e['in'] if e.get('in') is not None else (ln if e.get('stay') is True else min(tin, ln))))
    b = 1.0 if e.get('stay') is True else smooth((e['t1'] - lt) / max(1e-6, e['out'] if e.get('out') is not None else min(tout, ln)))
    return min(a, b)


CARRY_SKIP = {'do', 'who', 't0', 't1', 'in', 'out', 'stay', 'carried', 'u', 't', 'dur', 'sfx', 'cut', 'why', 'mute'}
CARRY_IN = {'look': 0.5, 'gesture': 0.35}  # default entry and exit of the hold — as lookK / gestAt in stage.ts


def carry_in(events: list, cast: list, dur: float, carry: dict) -> None:
    """Look and gesture from the previous shot of the scene → a "carried" event (fully from the first frame, the gesture in its final phase)
    for the figures of the shot, until a new event of the same figure replaces it: a look — smoothly towards the new one, a gesture —
    leaves 0.35 s before the new one starts. Appended to the end of events: event numbers of sounds do not shift, eventOf finds the
    shot's own events first."""
    for (kind, who), c in list(carry.items()):
        if who not in cast:  # the figure is not in the next shot (an insert) — the hold ended
            carry.pop((kind, who))
            continue
        nxt = min((e for e in events if e['do'] == kind and e.get('who') == who and not e.get('carried')), key=lambda e: e['t0'], default=None)
        ev = {**c['ev'], 'do': kind, 'who': who, 't0': 0.0, 'in': 0, 'carried': c['shot']}
        if nxt is None:
            ev.update({'t1': round(dur, 3), 'stay': True})
        elif kind == 'look':
            ln = max(1e-6, nxt['t1'] - nxt['t0'])
            tin = nxt['in'] if nxt.get('in') is not None else (ln if nxt.get('stay') is True else min(CARRY_IN[kind], ln))
            ev.update({'t1': round(nxt['t0'] + tin, 3), 'out': round(max(0.05, tin), 3)})
        else:
            ev.update({'t1': round(nxt['t0'], 3), 'out': round(max(0.05, min(CARRY_IN[kind], nxt['t0'])), 3)})
        events.append(ev)


def carry_out(events: list, dur: float, carry: dict, sid: str) -> None:
    """What a figure ended the shot with: look / gesture held to the end (k ≥ 0.5: "stay": true or an event until the end) → into the next shot of the scene."""
    for kind, tin in CARRY_IN.items():
        for who in {e.get('who') for e in events if e['do'] == kind and e.get('who')}:
            mine = [e for e in events if e['do'] == kind and e.get('who') == who]
            best = max(mine, key=lambda e: hold_k(e, dur, tin, tin))
            if hold_k(best, dur, tin, tin) >= 0.5:
                carry[(kind, who)] = {'shot': best.get('carried') or sid, 'ev': {k: v for k, v in best.items() if k not in CARRY_SKIP}}
            else:
                carry.pop((kind, who), None)


def compile_shot(ov: dict, sid: str, dur: float, state: dict, lib: dict, issues: list) -> dict:
    """Shot events → {'events', 'props', 'paths', 'sfx', 'flicker', 'lampOff'}. state — prop states of the scene (mutated)."""
    acts = lib['actions']
    bad = lambda msg: issues.append({'shot': sid, 'rule': 'event', 'msg': msg})
    evs, sfx, paths, flick, lamp_off = [], [], {}, [], None
    tracks = {}

    def key(obj, k, t, v):
        tr = tracks.setdefault(obj, {}).setdefault(k, [])
        if not tr and t > 0:
            tr.append([0.0, v])
        tr.append([round(t, 3), v])

    raw = sorted(ov.get('events', []), key=lambda e: span(e, dur, acts.get(e.get('do'), {}))[0])
    for e in raw:
        do = e.get('do')
        act = acts.get(do)
        if act is None:
            bad(f'no action "{do}" in the library (lib/staging/actions.json)')
            continue
        t0, t1 = span(e, dur, act)
        ev = {**{k: v for k, v in e.items() if k not in ('u', 't', 'dur')}, 't0': t0, 't1': t1}
        idx = len(evs)
        evs.append(ev)
        obj = e.get('obj')
        if do == 'set':
            if not obj:
                bad('set without obj')
                continue
            for k, v in e.items():
                if k in RESERVED or not isinstance(v, (int, float)):
                    continue
                old = state.get(obj, {}).get(k)
                if old is not None and abs(old - v) > 0.02 and not e.get('cut'):
                    issues.append({'shot': sid, 'rule': 'state jump', 'msg': f'{obj}.{k}: {old} in the previous shot of the scene, {v} here — needs a transition or "cut": "<why>"'})
                state.setdefault(obj, {})[k] = v
                key(obj, k, 0.0, v)
        elif act.get('prop') and (obj or not do.startswith('lamp.')):  # a lamp without obj — the lamp above the hero: the kit knows it
            if not obj:
                bad(f'{do} without obj')
                continue
            k = act['prop']
            cur = state.get(obj, {}).get(k)
            v0 = cur if cur is not None else e.get('from', act.get('from'))
            v1 = e.get('to', act.get('to'))
            if v0 is None or v1 is None:
                bad(f'{do} {obj}: from/to not set')
                continue
            if cur is not None and 'from' in e and abs(cur - e['from']) > 0.02 and not e.get('cut'):
                issues.append({'shot': sid, 'rule': 'state jump', 'msg': f'{obj}.{k}: was {cur}, the event starts from {e["from"]}'})
            if e.get('cut') and 'from' in e:
                v0 = e['from']
            key(obj, k, t0, v0)
            key(obj, k, t1, v1)
            state.setdefault(obj, {})[k] = v1
            ev['from'], ev['to'] = v0, v1
        if do == 'lamp.flicker' and not obj:
            flick.append([t0, t1])
        if do == 'lamp.off' and not obj:
            lamp_off = t0
        if do == 'walk':
            who, a, b = e.get('who'), e.get('from'), e.get('to')
            p = paths.setdefault(who, {'path': [], 'shoe': e.get('shoe', 'soft')})
            if a is None and p['path']:
                a = p['path'][-1][3]
            if not who or a is None or b is None or t1 <= t0:
                bad(f'walk: needs who, from, to and a length ({e})')
                continue
            ev['from'] = a
            p['path'].append([round(t0 / dur, 4), round(t1 / dur, 4), a, b])
            off = e.get('offscreen')  # true — the whole path is out of frame; [u0, u1] — shot fractions where the figure is not visible (darkness, beyond the edge)
            if off:
                p.setdefault('offscreen', []).append([t0, t1] if off is True else [off[0] * dur, off[1] * dur])
            n = steps_of(a, b)
            T = t1 - t0
            rate = n / T / (1 - ramp_of(T))  # pace on the steady part
            lo, hi = PACE[e.get('pace', 'walk')]
            ev['steps'], ev['rate'] = n, round(rate, 2)
            if n and not lo <= rate <= hi:
                issues.append({'shot': sid, 'rule': 'step pace', 'msg': f'{who}: {math.hypot(b[0] - a[0], b[1] - a[1]):.1f} m in {T:.1f} s = {rate:.1f} steps/s '
                               f'("{e.get("pace", "walk")}" — {lo}–{hi}); fix the path, the time or pace'})
        if do == 'cue' and not e.get('see'):
            bad('cue without see: what is visible in the frame at the sound')
        if do in ('walk', 'gesture') and not e.get('who'):
            bad(f'{do} without who')
        if do == 'gesture':
            pose = e.get('pose')
            if pose not in lib.get('poses', {}):
                bad(f'gesture: no pose "{pose}" in the library (lib/staging/actions.json → poses: {", ".join(lib.get("poses", {}))})')
        if act.get('need'):  # required fields of the action (kit event id and so on)
            for k in act['need']:
                if e.get(k) in (None, ''):
                    bad(f'{do}: "{k}" not set')
        if do == 'cut' and not e.get('why'):
            bad('cut without why: why there is a cut inside the shot')
        # event sounds: [id, progress fraction 0–1, offset s] — time by the event progress (smooth), not by the time fraction
        ss = e['sfx'] if 'sfx' in e else act.get('sfx', [])
        ss = [[ss, 0, 0]] if isinstance(ss, str) else (ss or [])
        for s in ss:
            s = [s, 0, 0] if isinstance(s, str) else list(s) + [0, 0][len(s) - 1:]
            at = t0 + inv_smooth(seen_frac(s[1], ev)) * (t1 - t0) + s[2]
            sfx.append({'name': s[0], 'at': round(max(0.0, min(dur - 0.1, at)), 3), 'event': idx,
                        'offscreen': bool(e.get('offscreen')) or s[0] in act.get('offscreen', [])})
    # a prop moves only with a cause (production rules 5, 7): an action with "hand" — who and their gesture at the start of the motion,
    # or "hand": "<why the hand is not visible>", or "by": "<what moves it>"
    for ev in evs:
        act = acts.get(ev['do'], {})
        if not act.get('hand') or ev.get('by') or (isinstance(ev.get('hand'), str) and ev['hand'].strip()):
            continue
        who = ev.get('who')
        if not who:
            issues.append({'shot': sid, 'rule': 'motion without a cause', 'msg': f'{ev["do"]} {ev.get("obj", "")}: the prop moves by itself — needs who and their gesture, '
                           f'or "hand": "<why the hand is not visible>", or "by": "<what moves it>"'})
            continue
        if not any(g['do'] == 'gesture' and g.get('who') == who and not g.get('carried') and g['t0'] <= ev['t0'] + 0.15 and g['t1'] >= ev['t0'] for g in evs):
            issues.append({'shot': sid, 'rule': 'motion without a cause', 'msg': f'{ev["do"]} {ev.get("obj", "")}: {who} has no gesture at the start of the motion — the arm hangs, '
                           f'the door moves by itself; add a gesture or "hand": "<why the hand is not visible>"'})
    # props of the scene the shot says nothing about keep their state
    for obj, ks in state.items():
        for k, v in ks.items():
            if k not in tracks.get(obj, {}):
                key(obj, k, 0.0, v)
    return {'events': evs, 'props': tracks, 'paths': paths, 'sfx': sfx, 'flicker': flick, 'lampOff': lamp_off}


def check_timeline(tl: dict, lib: dict, sfx_lib: dict | None = None) -> list:
    """Staging checks by timeline.json data (no frames). → [{'shot', 'rule', 'msg', 'level'}]; level: error / manual / eye (VO — by eye)."""
    out = [{**i, 'level': 'error'} for i in tl.get('stage_issues', [])]
    shots = {s['id']: s for s in tl['shots']}
    loops = {k for k, v in (sfx_lib or {}).get('sounds', {}).items() if v.get('loop')}
    for s in tl['shots']:
        # ambience by place (production rule 13): the shot has no bed — neither named by the script nor the default bed of the place
        if 'bed' in s and not s['bed'] and s.get('kit') and s['kit'] != 'black':
            out.append({'shot': s['id'], 'rule': 'shot without ambience', 'level': 'error',
                        'msg': f'the place "{s["location"]}" has no ambience (channel.json → locations.{s["location"]}.ambience), the script does not name one; silence by design — "bed": false'})
        for e in s.get('stage', {}).get('events', []):
            # cue is a manual binding: only the sound of an out-of-frame source or starting a loop; visible motion is set
            # by a library action
            ss = e.get('sfx')
            names = [ss] if isinstance(ss, str) else [x if isinstance(x, str) else x[0] for x in (ss or [])]
            if e['do'] == 'cue' and not e.get('offscreen') and not any(n in loops for n in names):
                out.append({'shot': s['id'], 'rule': 'cue on visible motion', 'level': 'error',
                            'msg': f'cue "{", ".join(names)}" ({e.get("see", "")}): visible motion is set by a library action (the sound comes from the same event), '
                                   f'cue — only an out-of-frame source ("offscreen": true) and starting an ambience loop'})
    for x in tl['sfx']:
        if x.get('loop'):
            continue
        s = shots[x['shot']]
        off = x['start'] - s['start']
        if x.get('event') is None:
            out.append({'shot': x['shot'], 'rule': 'sound without an event', 'level': 'error',
                        'msg': f'{x["id"] or x["name"]} at {off:.2f} s of the shot — no event in staging.json (placed by a rule, not by the frame)'})
        elif x.get('manual'):
            out.append({'shot': x['shot'], 'rule': 'manual binding', 'level': 'manual', 'msg': f'{x["id"]} at {off:.2f} s — {x["manual"]}'})
        for h in x.get('hits', [x['start']]):
            if h > s['end'] - 0.08:
                out.append({'shot': x['shot'], 'rule': 'sound on a cut', 'level': 'error', 'msg': f'{x["id"]} at {h - s["start"]:.2f} s — in the last 0.08 s of the shot'})
    # shot line → event: an action verb of ON SCREEN / camera without an event is an error; VO of an English script — a list
    # for the eye (eye)
    out += [{k: i[k] for k in ('shot', 'rule', 'level', 'msg')} for i in verb_issues(tl, lib, sfx_lib)]
    out += loop_sources(tl, sfx_lib)
    for s in tl['shots']:
        evs = s.get('stage', {}).get('events', [])
        for e in evs:
            if e.get('who') and e['do'] in ('walk', 'gesture', 'look') and not e.get('carried') and not any(c['who'] == e['who'] for c in s['cast']):
                out.append({'shot': s['id'], 'rule': 'event', 'level': 'error', 'msg': f'{e["do"]}: {e["who"]} is not in the frame (cast)'})
    return out


def loop_sources(tl: dict, sfx_lib: dict | None, journal: list | None = None) -> list:
    """A loop that needs a visible source (sfx.json → "needs": [prefixes], "see": what is visible): in the shot where the loop starts there is
    an event or a staging prop with this prefix (do or obj: "water", "tap."), a cue of this sound with "see" (that the source is visible is
    checked by the frame journal), a PropMark in the journal (journal: [{shot, props: [id…]}]) or the shot has
    "offscreen_sfx": {"<id>": "<why the source is clear without the frame>"}. Otherwise — an error."""
    lib = (sfx_lib or {}).get('sounds', {})
    shots = {s['id']: s for s in tl['shots']}
    marks = {}
    for j in journal or []:
        for p in j.get('props', []):
            marks.setdefault(j.get('shot'), set()).add(str(p.get('id') if isinstance(p, dict) else p))
    out = []
    for x in tl.get('sfx', []):
        e = lib.get(x.get('id') or '', {})
        if not x.get('loop') or x.get('bed') or not e.get('needs'):
            continue
        s = shots.get(x['shot'])
        if s is None:
            continue
        pre = e['needs']
        evs = s.get('stage', {}).get('events', [])
        names = [ev['do'] for ev in evs] + [ev.get('obj') or '' for ev in evs] + list(s.get('stage', {}).get('props', {}))
        why = (s.get('offscreen_sfx') or {}).get(x['id'])
        cue = any(ev['do'] == 'cue' and not ev.get('offscreen') and ev.get('see') and x['id'] in (ev['sfx'] if isinstance(ev.get('sfx'), list) else [ev.get('sfx')])
                  for ev in evs)
        if any(n.startswith(p) for n in names for p in pre) or any(m.startswith(p) for m in marks.get(s['id'], ()) for p in pre) or cue or (why and str(why).strip()):
            continue
        out.append({'shot': s['id'], 'rule': 'loop without a source', 'level': 'error',
                    'msg': f'{x["id"]} from {x["start"] - s["start"]:.2f} s of the shot: {e.get("see", "the sound source")} — not in the shot ({", ".join(pre)}): '
                           f'add an event or a staging prop (the kit draws it and sets a PropMark), or remove the sound ("sfx": {{"{x["id"]}": null}}), '
                           f'or "offscreen_sfx": {{"{x["id"]}": "<why the source is clear without the frame>"}}'})
    return out


# ---------- shot line → event (production rule 9a): an action verb of ON SCREEN / camera without an event is an error ----------
# Dictionary — lib/staging/actions.json → verbs (common) and channel.json → action_verbs (channel, they go first). Entry: re — the verb
# over the line (lower case), need — event variants (any of the list), what — what it is. A variant is requirements joined by "+":
#   <do>[:<v>|<v>][!<field>][@] — an event whose name starts with <do>; :v — pose / to / obj / pace starts with v;
#     !field — the event has the field (walk!at — the path ends at the prop at); @ — an event of the one who acts (the subject of the line);
#   sfx:<id>|<id> — a sound of the shot (an event or a cue); line@ — a line of the one who acts; line:any — any line in the shot;
#   line:who — a line of the role from the group (?P<who>…) of the expression ("in time with the mother's voice").
# A matched piece of the line is closed: the specific (door, finger, lamp) goes earlier in the dictionary than the general (walks, looks).
# A state description (stands, holds, frozen, looking, sits still) is not a dictionary verb; a negation ("does not move", "no answer",
# "without …", "as if …") is cut out before the search. A shot exception — staging.json "verbs_ok": {"<phrase>": "<why>"}.
_NEG = [re.compile(r"\b(?:does|do|did|is|are|was|were|has|have|can|could|will|would)(?:n't| not)\b(?:\s+\w+){1,2}"),
        re.compile(r"\b(?:no|never|not|without|nor)\b[^;,.]*"), re.compile(r"\bas if\b[^;,.]*")]
_CAM_MOVE = re.compile(r"^(?:(?:slow|slight|fast|quick|gentle|very|then)\s+)*(?:push|pull|pan|tilt|slide|narrow|track|crane|zoom|dolly|drift|move|cut|follow|rack|creep)\w*\b")
_PRON = re.compile(r"\b(he|him|his|she|her|hers)\b")
_GEN = re.compile(r"\b(?:the|a|an)\s+(man|woman|boy|girl)\b")
# the word right before the verb (adverbs are skipped): a subject without a role is a prop; a body part — of the one the line is about
_HEAD = re.compile(r"([a-z']+)\s+(?:(?:slowly|quickly|fast|still|then|and|just|already|suddenly|finally|also|briefly|almost)\s+)*$")
_BODY = {'eyes', 'eye', 'fingers', 'finger', 'fingertip', 'fingertips', 'hand', 'hands', 'head', 'lips', 'mouth', 'feet', 'foot', 'legs', 'leg',
         'arm', 'arms', 'shoulder', 'shoulders', 'face', 'gaze', 'palm', 'thumb', 'knees', 'body', 'and', 'then'}


def _prep(s: str) -> str:
    s = (s or '').replace('’', "'").replace('“', '"').replace('”', '"')
    s = re.sub(r'\([^)]*\)', ' ', s)          # notes in brackets: (calm), (0.7s), (toward camera)
    s = re.sub(r'"([^"]*)"', r'\1', s).lower()
    for rx in _NEG:
        s = rx.sub(' ', s)
    return s


def _clauses(s: str) -> list:
    """Line → clauses (;, full stop, dash, colon) and in each — pieces (comma, then) with positions: [(clause, [(start, end), …])]."""
    out = []
    for c in re.split(r'\s*(?:;|(?<!\d)\.(?!\d)|\s[—–]\s|:)\s*', s):
        if not c.strip():
            continue
        spans, pos = [], 0
        for m in re.finditer(r',\s*|\s+(?:and\s+)?then\s+', c):
            spans.append((pos, m.start()))
            pos = m.end()
        spans.append((pos, len(c)))
        out.append((c, spans))
    return out


def _people(lib: dict):
    """Roles by words: channel names (channel.json → names), cast_words of the channel. → [(regex, role)], gender of a role."""
    pats = [(re.compile(p), who) for who, ps in lib.get('names', {}).items() for p in ps]
    pats += [(re.compile(cw['re']), cw['who']) for cw in lib.get('cast_words', [])]
    pron = lib.get('cast_pron', {})
    gender = lambda who: next((g for g, ws in pron.items() if who in ws), 'he')
    return pats, gender


def _parse_need(alt: str) -> list:
    out = []
    for t in alt.split('+'):
        m = re.match(r'^(?P<do>[a-z_.]+)(?::(?P<val>[^!@]+))?(?:!(?P<field>\w+))?(?P<who>@)?$', t.strip())
        if not m:
            raise ValueError(f'verbs: cannot parse the requirement "{t}"')
        out.append({'do': m['do'], 'val': m['val'].split('|') if m['val'] else [], 'field': m['field'], 'who': bool(m['who'])})
    return out


def _need_text(alt: str, subj, group=None) -> str:
    parts = []
    for q in _parse_need(alt):
        w = f' {subj}' if q['who'] and subj else ''
        if q['do'] == 'sfx':
            parts.append(f'sound {"/".join(q["val"])} in the shot')
        elif q['do'] == 'line':
            parts.append('a line in the shot' if q['val'] == ['any'] else f'a line of {group} in the shot' if q['val'] == ['who'] else f'a line{w or " of the speaker"} in the shot')
        else:
            parts.append(f'{q["do"]}{" " + "/".join(q["val"]) if q["val"] else ""}{w}{" with " + repr(q["field"]) if q["field"] else ""}')
    return ' + '.join(parts)


def _canon(tl: dict, role: str) -> set:
    """Role → names of its lines: as in the script (as) and the voice (speaker); a processed copy <NAME>_VOICE is the same voice."""
    names = {role}
    names |= {ln['speaker'] for ln in tl.get('lines', []) if ln.get('as') == role}
    return names


def _ok(q: dict, evs: list, subj, sid: str, tl: dict, lines: list, group_role) -> bool:
    if q['do'] == 'sfx':
        ids = set(q['val'])
        return any(x['shot'] == sid and ({x.get('id'), x.get('name')} & ids) for x in tl.get('sfx', [])) or \
            any(e['do'] == 'cue' and (e.get('sfx') in ids or (isinstance(e.get('sfx'), list) and ids & {s if isinstance(s, str) else s[0] for s in e['sfx']})) for e in evs)
    if q['do'] == 'line':
        spoken = [ln for ln in lines if ln.get('speaker') != 'NARRATOR']
        if q['val'] == ['any']:
            return bool(spoken)
        role = group_role if q['val'] == ['who'] else (subj if q['who'] else None)
        if not role:
            return bool(spoken)
        names = _canon(tl, role)
        return any(ln.get('as') in names or ln.get('speaker') in names for ln in spoken)
    for e in evs:
        if e.get('carried') or not e['do'].startswith(q['do']):
            continue
        if q['val']:
            have = [x for x in (e.get('pose'), e.get('to') if isinstance(e.get('to'), str) else None, e.get('obj'), e.get('pace')) if isinstance(x, str)]
            if not any(h.startswith(v) for v in q['val'] for h in have):
                continue
        if q['field'] and not e.get(q['field']):
            continue
        if q['who'] and subj and e.get('who') != subj:
            continue
        return True
    return False


def verb_issues(tl: dict, lib: dict, sfx_lib: dict | None = None, vo: bool = True) -> list:
    """Action verbs of ON SCREEN and camera without a staging event. → [{'shot', 'rule', 'level', 'msg', 'phrase', 'src', 'who', 'need', 'what'}];
    level: error (ON SCREEN / camera), eye (VO of an English script — a list for the eye)."""
    pats, gender = _people(lib)
    rx = [(re.compile(v['re']), v) for v in lib.get('verbs', [])]
    rx_vo = [(re.compile(v['re']), v) for v in lib.get('vo_verbs', [])]
    known = set((sfx_lib or {}).get('sounds', {})) | set((sfx_lib or {}).get('planned', {}))
    out = []
    scene, hist = None, []  # roles of the previous shots of the scene — for "she" without a name in the shot
    for s in tl['shots']:
        if s['scene'] != scene:
            scene, hist = s['scene'], []
        sid = s['id']
        evs = s.get('stage', {}).get('events', [])
        cast = [c['who'] for c in s.get('cast', [])]
        people = [w for w in cast if gender(w) != 'it']
        lines = [ln for ln in tl.get('lines', []) if ln['shot'] == sid]
        ok_map = {_prep(k).strip(): v for k, v in (s.get('verbs_ok') or {}).items()}
        used = set()
        last = {}  # gender → the last named role

        def resolve(g):
            if last.get(g):
                return last[g]
            cand = [w for w in people if gender(w) == g]
            if cand:
                return cand[0]
            for w in reversed(hist):
                if gender(w) == g:
                    return w
            return None

        def refs(piece):
            rr = []
            for p, who in pats:
                for m in p.finditer(piece):
                    rr.append((m.start(), m.end(), who))
            for m in _PRON.finditer(piece):
                rr.append((m.start(), m.end(), 'she' if m.group(1) in ('she', 'her', 'hers') else 'he'))
            for m in _GEN.finditer(piece):
                rr.append((m.start(), m.end(), 'she' if m.group(1) in ('woman', 'girl') else 'he'))
            return sorted(rr)

        srcs = [('camera', s.get('camera', ''), rx), ('ON SCREEN', s.get('on_screen', ''), rx)]
        if vo:
            srcs += [('VO', t, rx_vo + rx) for t in s.get('vo_src', [])]
        found_all = {}  # (src, need) → entry: "a tub falls and rolls" — one error
        for src, text, table in srcs:
            subj_clause = None
            for clause, spans in _clauses(_prep(text)):
                masked = clause
                if src == 'camera':  # a camera move is not an event ("slow push-in", "slide down to …", "tracking alongside …")
                    for a0, b0 in spans:
                        if _CAM_MOVE.match(clause[a0:b0].strip()):
                            masked = masked[:a0] + ' ' * (b0 - a0) + masked[b0:]
                rr = refs(clause)
                found = []
                for r, v in table:
                    for m in r.finditer(masked):
                        found.append((m.start(), m, v))
                        masked = masked[:m.start()] + ' ' * (m.end() - m.start()) + masked[m.end():]
                # subject: the nearest role before the verb in the clause, else — of the previous clause of this line, else — the only
                # person of the shot
                cur = subj_clause
                for pos, m, v in sorted(found, key=lambda x: x[0]):
                    before = [w for a0, b0, w in rr if b0 <= pos]
                    for w in before[:-1]:  # named roles before the subject — for a pronoun
                        if w not in ('he', 'she'):
                            last[gender(w)] = w
                    who = before[-1] if before else cur
                    if who in ('he', 'she'):
                        who = resolve(who)
                    explicit = who is not None
                    if who is None and len(people) == 1:
                        who = people[0]
                    if who:
                        last[gender(who)] = who
                    cur = who if explicit else cur
                    group_role = None
                    if 'who' in (m.groupdict() or {}) and m.group('who'):
                        word = m.group('who')
                        group_role = next((w for p, w in pats if p.search(word)), word.upper())
                    alts = [_parse_need(alt) for alt in v['need']]
                    # the subject is a thing, not a person ("the light comes in"): a human verb does not apply to it
                    if not before and all(any(q['who'] for q in alt) for alt in alts):
                        w0 = _HEAD.search(clause[:pos])
                        if w0 and w0.group(1) not in _BODY:
                            continue
                    if any(all(_ok(q, evs, who, sid, tl, lines, group_role) for q in alt) for alt in alts):
                        continue
                    phrase = m.group(0).strip()
                    piece = next((clause[a0:b0] for a0, b0 in spans if a0 <= pos < b0), clause)
                    hit = next((k for k in ok_map if k and (k in clause or phrase in k)), None)
                    if hit is not None:
                        used.add(hit)
                        continue
                    by_who = any(q['who'] for alt in alts for q in alt)
                    if src == 'VO' and (not explicit or who not in cast or not by_who):
                        continue  # a story about someone not in the frame or not named is not a task of the shot
                    need = ' or '.join(_need_text(alt, who if by_who else None, group_role) for alt in v['need'])
                    key = (src == 'VO', need)
                    if key in found_all:
                        found_all[key]['phrase'] += f'; {phrase}'
                        continue
                    notes = []
                    sfx_ids = [x for alt in alts for q in alt if q['do'] == 'sfx' for x in q['val']]
                    if known and sfx_ids and all(q['do'] == 'sfx' for alt in alts for q in alt) and not set(sfx_ids) & known:
                        notes.append('the sound is not in sfx.json (do not generate it) — fix the line')
                    if who and who not in cast and by_who:
                        notes.append(f'{who} is not in the shot cast — put the figure in the frame or fix the line')
                    found_all[key] = {'shot': sid, 'rule': 'VO — by eye' if src == 'VO' else 'action without an event', 'level': 'eye' if src == 'VO' else 'error',
                                      'src': src, 'phrase': phrase, 'piece': piece.strip(), 'who': who if by_who else None, 'need': need,
                                      'what': v['what'], 'notes': notes}
                subj_clause = cur
        for i in found_all.values():
            w = f', {i["who"]}' if i['who'] else ''
            nt = '; ' + '; '.join(i['notes']) if i['notes'] else ''
            i['msg'] = (f'VO "{i["phrase"]}" ({i["what"]}{w}): does the frame show it? event: {i["need"]}' if i['level'] == 'eye' else
                        f'{i["src"]} "{i["phrase"]}" ({i["what"]}{w}) — no event: {i["need"]}{nt}. Add an event, or fix the line '
                        f'ON SCREEN / camera in both versions, or "verbs_ok": {{"{i["phrase"].split("; ")[0]}": "<why the frame shows it without an event>"}}')
            out.append(i)
        for k, why in ok_map.items():
            if not str(why or '').strip():
                out.append({'shot': sid, 'rule': 'action without an event', 'level': 'error', 'msg': f'verbs_ok "{k}" without a reason'})
            elif k not in used:
                out.append({'shot': sid, 'rule': 'action without an event', 'level': 'error',
                            'msg': f'verbs_ok "{k}": the line has no such phrase with a verb without an event — remove the entry'})
        hist += people
    return out


if __name__ == '__main__':
    # python tools/pipeline/staging.py verbs <work folder | timeline.json> [--shots 04.02,19.01] [--md file.md] — line → event
    a = sys.argv[1:]
    if len(a) < 2 or a[0] != 'verbs':
        sys.exit('python tools/pipeline/staging.py verbs <work folder | timeline.json> [--shots …] [--md file.md]')
    from tools.pipeline.common import Channel, channel_of_work  # noqa: E402
    p = Path(a[1]).resolve()
    tlp = p if p.suffix == '.json' else p / 'timeline.json'
    tl = load_json(tlp)
    chn = Channel(channel_of_work(tlp.parent, tl))
    opt = lambda k: a[a.index(k) + 1] if k in a else None
    only = set(opt('--shots').split(',')) if opt('--shots') else None
    res = [i for i in verb_issues(tl, load_actions(chn.cfg), chn.sfx) if not only or i['shot'] in only]
    for i in res:
        print(f'{i["level"]:5} {i["shot"]} {i["msg"]}')
    print(f'errors {sum(i["level"] == "error" for i in res)}, for the eye (VO) {sum(i["level"] == "eye" for i in res)}')
    if opt('--md'):
        md = ['| Shot | Where | Phrase | Who | Needed event |', '|---|---|---|---|---|']
        md += [f'| {i["shot"]} | {i.get("src", "")} | "{i.get("phrase", "")}" | {i.get("who") or ""} | {i.get("need", i["msg"])} |' for i in res]
        Path(opt('--md')).write_text('\n'.join(md) + '\n', encoding='utf-8')
