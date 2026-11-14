"""Step 5: chapter sound. Speech, sounds of the channel library and music inserts → audio/mix.wav (48 kHz, stereo).

- Speech: every line to its own loudness (voices.json: narrator −17 LUFS, the rest −18), at its place by the timeline.
- Place ambience (timeline: a sound with "bed": true) — a continuous track: the same bed is not interrupted at a cut, different beds
  change with an equal-power crossfade (fade [in, out], s) — no dropout into silence at a cut (production rule 13).
  The ambience track is also written to audio/amb.wav — the "ambience dropout at a cut" check measures it (stage_check.py).
- Sounds: pipeline/sfx.json → assets/sound/; a loop runs until the end of the scene or until "(stop)". No file — silence and a line
  in audio/sfx_missing.md (the full list and the estimate — tools/pipeline/sfx_list.py → sfx_needed.md; generation — only on the owner's command).
  An sfx.json entry: trim — the working piece, af — an ffmpeg filter (infrasound cut for beds, stair echo), slices — separate steps.
  A step train: a timeline sound with hits [t, …] — one step from slices per mark (round robin, ±1.5 dB spread), loudness — lufs of the entry.
- Music: a piece of a track (music.json), to −24 LUFS, fade in 0.6 s, fade out 1.5 s, ducked under speech (−9 dB).
- Master: two-pass loudnorm — −16 LUFS, true peak ≤ −1.5 dBTP in the mp4 (−3.0 in the WAV — headroom for AAC).
audio/speech.wav is written separately — speech only, for the speech recognition check.
"""
import json
import re
import subprocess
import zlib
from pathlib import Path

import numpy as np

from tools.pipeline.common import Channel, ffmpeg, log
from tools.pipeline.voice import loudness

SR = 48000


def decode(path, start=None, dur=None, mono=False, af=None) -> np.ndarray:
    cmd = ['ffmpeg', '-v', 'error']
    if start is not None:
        cmd += ['-ss', f'{start:.3f}']
    if dur is not None:
        cmd += ['-t', f'{dur:.3f}']
    cmd += ['-i', str(path)] + (['-af', af] if af else []) + ['-ac', '1' if mono else '2', '-ar', str(SR), '-f', 'f32le', '-']
    raw = subprocess.run(cmd, capture_output=True, check=True).stdout
    a = np.frombuffer(raw, np.float32)
    return a if mono else a.reshape(-1, 2)


def write_wav(path, x: np.ndarray, pcm='pcm_f32le'):
    x = np.ascontiguousarray(x, dtype=np.float32)
    p = subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'f32le', '-ar', str(SR), '-ac', str(x.shape[1] if x.ndim > 1 else 1), '-i', '-',
                        '-c:a', pcm, str(path)], input=x.tobytes(), capture_output=True)
    if p.returncode:
        raise RuntimeError(p.stderr.decode(errors='replace')[-800:])


def lufs_of(x: np.ndarray, tmp: Path) -> float:
    if len(x) < SR:  # loudness is not measured for less than a measuring block (0.4 s) (−70): a short sound is padded with silence to 1 s
        x = np.concatenate([x, np.zeros((SR - len(x),) + x.shape[1:], np.float32)])
    write_wav(tmp, x)
    return loudness(tmp)


def place(bus: np.ndarray, x: np.ndarray, t: float):
    i = int(round(t * SR))
    if i < 0:
        x, i = x[-i:], 0
    n = min(len(x), len(bus) - i)
    if n > 0:
        bus[i:i + n] += x[:n]


def ramp(n_in, n_out, n):
    g = np.ones(n, np.float32)
    if n_in:
        g[:min(n, n_in)] = np.linspace(0, 1, n_in, dtype=np.float32)[:min(n, n_in)]
    if n_out:
        k = min(n, n_out)
        g[n - k:] *= np.linspace(1, 0, n_out, dtype=np.float32)[n_out - k:]
    return g


def xramp(n_in: int, n_out: int, n: int, eq_in: bool, eq_out: bool) -> np.ndarray:
    """Edges of the ambience track: equal-power in/out (sin/cos) on a crossfade with the neighbouring bed, linear at silence."""
    g = np.ones(n, np.float32)
    k = min(n, n_in)
    if k > 0:
        t = np.linspace(0, 1, n_in, dtype=np.float32)[:k]
        g[:k] = np.sin(t * np.pi / 2) if eq_in else t
    k = min(n, n_out)
    if k > 0:
        t = np.linspace(1, 0, n_out, dtype=np.float32)[n_out - k:]
        g[n - k:] *= np.sin(t * np.pi / 2) if eq_out else t
    return g


def loop_to(x: np.ndarray, L: int, xf: int) -> np.ndarray:
    """A loop of length L: overlapping repeats with an equal-power crossfade of xf samples — no click or gap at the joint."""
    if len(x) <= 2 * xf:
        return np.tile(x, (L // max(1, len(x)) + 1, 1))[:L]
    step = len(x) - xf
    out = np.zeros((L + len(x), x.shape[1]), np.float32)
    t = np.linspace(0, np.pi / 2, xf, dtype=np.float32)
    head, tail = x[:xf] * np.sin(t)[:, None], x[-xf:] * np.cos(t)[:, None]
    i = 0
    while i < L:
        out[i:i + xf] += head if i else x[:xf]
        out[i + xf:i + step] += x[xf:step]
        out[i + step:i + len(x)] += tail
        i += step
    return out[:L]


def lead_trim(x: np.ndarray, db=-40, pre=0.01) -> np.ndarray:
    """One-shot sound: cut the silence before the start (40 dB below the peak) — the sound starts at the timeline mark."""
    a = np.abs(x).max(axis=1)
    if not a.size or a.max() <= 0:
        return x
    k = int(np.argmax(a > a.max() * 10 ** (db / 20)))
    return x[max(0, k - int(pre * SR)):]


def step_slices(meta: dict, p: Path, ch: Channel, ad: Path) -> list:
    """Steps of a train sound: pieces slices [[start, end], s of the file] → arrays with soft edges, after the af filter of the entry
    (stair echo — with a 0.6 s tail). One loudness for all steps: lufs of the entry over a train of these steps 0.5 s apart."""
    af = meta.get('af')
    out = []
    for a, b in meta.get('slices') or [[0, None]]:
        f = f'apad=pad_dur=0.6,{af}' if af else None
        x = decode(p, start=a, dur=(b - a) if b else None, af=f)
        x = lead_trim(x)
        out.append(x * ramp(int(0.005 * SR), int(0.06 * SR), len(x))[:, None])
    train = np.zeros((int(0.5 * SR) * len(out) + max(len(x) for x in out), 2), np.float32)
    for k, x in enumerate(out):
        place(train, x, 0.5 * k)
    target = meta.get('lufs', ch.sfx['default_lufs']['oneshot'])
    g = 10 ** ((target - lufs_of(train, ad / '_tmp.wav') + meta.get('gain_db', 0)) / 20)
    return [x * g for x in out]


def loudnorm(src: Path, dst: Path, I=-16, TP=-1.5, LRA=11):
    r = subprocess.run(['ffmpeg', '-hide_banner', '-nostats', '-i', str(src), '-af', f'loudnorm=I={I}:TP={TP}:LRA={LRA}:print_format=json',
                        '-f', 'null', '-'], capture_output=True, text=True, encoding='utf-8', errors='replace')
    m = json.loads(r.stderr[r.stderr.rfind('{'):r.stderr.rfind('}') + 1])
    af = (f'loudnorm=I={I}:TP={TP}:LRA={LRA}:measured_I={m["input_i"]}:measured_TP={m["input_tp"]}:measured_LRA={m["input_lra"]}'
          f':measured_thresh={m["input_thresh"]}:offset={m["target_offset"]}:linear=true')
    ffmpeg('-i', src, '-af', af, '-ar', SR, '-c:a', 'pcm_s16le', dst)
    return float(m['input_i'])


def run(tl: dict, wd: Path, ch: Channel):
    ad = wd / 'audio'
    ad.mkdir(parents=True, exist_ok=True)
    n = int(round(tl['duration'] * SR))
    speech = np.zeros((n, 2), np.float32)
    fx = np.zeros((n, 2), np.float32)
    amb = np.zeros((n, 2), np.float32)  # place beds — a separate track (amb.wav), mixed together with the sounds
    mus = np.zeros((n, 2), np.float32)
    vdir = wd / 'voice'
    est = 0
    for ln in tl['lines']:
        if not ln['file']:
            est += 1
            continue
        fxs = ch.voices.get('voice_suffix', {}).get('effects', {})
        fxe = fxs.get(ln.get('effect') or '')
        x = decode(vdir / ln['file'], mono=True, af=fxe['af'] if fxe else None)
        if ln.get('head'):  # staging.json voice_cut: an extra sound at the start of a take — silence up to head (the clip place is the same), a 10 ms edge
            k, f = min(len(x), int(ln['head'] * SR)), int(0.01 * SR)
            x = x.copy()
            x[:k] = 0
            x[k:k + f] *= np.linspace(0, 1, len(x[k:k + f]), dtype=np.float32)
        g = 10 ** ((ln['target_lufs'] - (ln['lufs'] if ln['lufs'] is not None else -23)) / 20)
        if fxe and 'norm_db' in fxe and len(x):
            # a narrow band (phone) cuts the fundamental: loudness is matched after the filter — to the line target
            # with the norm_db correction
            g = 10 ** ((ln['target_lufs'] + fxe['norm_db'] - lufs_of(np.repeat(x[:, None], 2, axis=1), ad / '_tmp.wav')) / 20)
        place(speech, np.repeat((x * g)[:, None], 2, axis=1), ln['clipStart'])
    # sounds
    missing = {}
    cache = {}
    for s in tl['sfx']:
        end = s['end'] if s['end'] is not None else None
        if not s['file']:
            if not s.get('id'):
                continue  # not from the library — silence (a sound the channel library does not have)
            m = missing.setdefault(s['id'], {'loop': s['loop'], 'shots': []})
            m['shots'].append(s['shot'])
            continue
        p = ch.dir / s['file']
        meta = ch.sfx['sounds'][s['lib']]  # entry of a ready sound
        if s.get('hits'):
            # step train: one step from the slices of the entry per mark (round robin, no repeat in a row), ±1.5 dB spread
            ck = (s['lib'], 'hits')
            if ck not in cache:
                cache[ck] = step_slices(meta, p, ch, ad)
            steps = cache[ck]
            off = zlib.crc32(f'{s.get("shot")}:{s["lib"]}'.encode())
            for k, ht in enumerate(s['hits']):
                h = zlib.crc32(f'{s.get("shot")}:{s["lib"]}:{k}'.encode())
                x = steps[(k + off) % len(steps)]
                place(fx, x * 10 ** (((h % 1000) / 1000 * 3 - 1.5) / 20), ht)
            continue
        ck = (p, s['loop'], s['lib'])
        if ck not in cache:
            tr = meta.get('trim') or (meta['slices'][0] if meta.get('slices') else None)  # working piece; steps without hits — one step
            af = meta.get('af')  # ffmpeg filter of the entry (infrasound cut for beds, stair echo)
            x = decode(p, start=tr[0], dur=tr[1] - tr[0], af=af) if tr else decode(p, af=af)
            if tr and not s['loop']:
                x = x * ramp(0, int(0.03 * SR), len(x))[:, None]  # end of the piece — without a click
            target = meta.get('lufs', ch.sfx['default_lufs']['loop' if s['loop'] else 'oneshot'])
            g = 10 ** ((target - lufs_of(x, ad / '_tmp.wav') + meta.get('gain_db', 0)) / 20)  # loudness — over the whole piece
            cache[ck] = (x if s['loop'] else lead_trim(x)) * g
        x = cache[ck]
        if s['loop']:
            L = int(round(((end or tl['duration']) - s['start']) * SR))
            if s.get('bed'):
                fi, fo = s.get('fade', [0.3, 0.5])
                qi, qo = s.get('xfade', [False, False])
                place(amb, loop_to(x, L, int(0.5 * SR)) * xramp(int(fi * SR), int(fo * SR), L, qi, qo)[:, None], s['start'])
                continue
            x = loop_to(x, L, int(0.5 * SR)) * ramp(int(0.3 * SR), int(0.5 * SR), L)[:, None]
        place(fx, x, s['start'])
    # music
    mc = ch.music
    for m in tl['music']:
        tr = mc['tracks'][m['track']]
        seg = decode(ch.dir / tr['file'], start=m['src'], dur=m['dur'])
        L = len(seg)
        if L == 0:
            continue
        g = 10 ** ((mc['lufs'] - lufs_of(seg, ad / '_tmp.wav')) / 20)
        seg = seg * g * ramp(int(mc['fade_in'] * SR), int(mc['fade_out'] * SR), L)[:, None]
        place(mus, seg, m['start'])
    # ducking: music lower under speech (speech mask by the timeline, smooth edges 0.25 s)
    mask = np.zeros(n, np.float32)
    for ln in tl['lines']:
        a, b = int(max(0, ln['start'] - 0.1) * SR), int(min(tl['duration'], ln['end'] + 0.2) * SR)
        mask[a:b] = 1
    k = int(0.25 * SR)
    if mask.any() and k > 1:
        ker = np.ones(k, np.float32) / k
        mask = np.convolve(mask, ker, mode='same')
    duck = 1 - mask * (1 - 10 ** (mc['duck_db'] / 20))
    mus *= duck[:, None]
    mix = speech + fx + amb + mus
    (ad / '_tmp.wav').unlink(missing_ok=True)
    write_wav(ad / 'speech.wav', speech[:, :1], pcm='pcm_s16le')
    write_wav(ad / 'amb.wav', amb[:, :1], pcm='pcm_s16le')
    write_wav(ad / 'mix_raw.wav', mix)
    if np.abs(speech).max() < 1e-6:
        # no speech (estimated durations): the master is not normalised, otherwise music and sounds would be raised to −16 LUFS
        write_wav(ad / 'mix.wav', mix, pcm='pcm_s16le')
        log(f'sound: no speech (estimated durations), music {len(tl["music"])} inserts — no loudness normalisation')
    else:
        # peak in the WAV −3.0: AAC 192k raises the true peak by up to 1 dB (measured: −2.0 → −1.4; −2.5 → −1.47), in the mp4 ≤ −1.5
        before = loudnorm(ad / 'mix_raw.wav', ad / 'mix.wav', TP=-3.0)
        log(f'sound: speech {len(tl["lines"]) - est} lines, sounds {len(tl["sfx"]) - sum(len(v["shots"]) for v in missing.values())} of {len(tl["sfx"])}, '
            f'music {len(tl["music"])} inserts; loudness before the master {before:.1f} LUFS → −16')
    # list of the needed sounds
    lines = ['# Sounds missing from the mix', '', 'Library sounds not generated yet (pipeline/sfx.json → planned) — silence in the mix. The full list and the estimate — sfx_needed.md (tools/pipeline/sfx_list.py).', '',
             '| Sound | Type | Shots |', '|---|---|---|']
    for name, v in sorted(missing.items()):
        lines.append(f'| {name} | {"loop" if v["loop"] else "one-shot"} | {", ".join(sorted(set(v["shots"])))} |')
    (ad / 'sfx_missing.md').write_text('\n'.join(lines) + '\n', encoding='utf-8')
    return ad / 'mix.wav', missing


def srt(tl: dict, out: Path):
    def ts(t):
        ms = int(round(t * 1000))
        return f'{ms // 3600000:02d}:{ms // 60000 % 60:02d}:{ms // 1000 % 60:02d},{ms % 1000:03d}'
    out.write_text(''.join(f'{i}\n{ts(c["from"])} --> {ts(c["to"])}\n{re.sub(r"[{}]", "", c["text"])}\n\n' for i, c in enumerate(tl['cues'], 1)),
                   encoding='utf-8')


def assemble(tl: dict, video: Path, mix: Path, out: Path):
    """Video (copied, not re-encoded) + AAC 192k sound → the chapter mp4; an .srt next to it."""
    ffmpeg('-i', video, '-i', mix, '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-t', f'{tl["duration"]:.3f}',
           '-movflags', '+faststart', out)
    srt(tl, out.with_suffix('.srt'))
    return out
