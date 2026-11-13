"""Step 2: speech. Lines of scenes.json → ElevenLabs (with-timestamps) → voice/<key>.mp3 + .json (character timings, loudness).

Cache by key (model, voice, settings, seed, text): a changed line — only it is voiced again.
Tags: no whisper by default; a tag from the script (VO (NARRATOR, [dry])) is repeated before every phrase — it only works
until the first pause.
Without --go only the estimate is printed (characters, credits); --estimate — durations from the text length, no API.
"""
import re
import subprocess
from pathlib import Path

from tools.pipeline.common import Channel, PipelineError, load_json, log, probe_duration, save_json, sha

SENT = re.compile(r'(?<=[.?!…])\s+')
TAG = re.compile(r'\[[^\]]*\]')


def tts_text(line: dict, repeat: bool) -> str:
    """Text for TTS: the line tags before every phrase (unless the phrase starts with its own tag)."""
    text = line['text'].strip()
    tags = ' '.join(line.get('tags') or [])
    if not tags:
        return text
    if not repeat:
        return f'{tags} {text}'
    parts = [p for p in SENT.split(text) if p.strip()]
    return ' '.join(p if p.lstrip().startswith('[') else f'{tags} {p}' for p in parts)


def display_text(text: str) -> str:
    return re.sub(r'\s{2,}', ' ', TAG.sub('', text)).strip()


def voice_cfg(ch: Channel, line: dict, model=None):
    sp = ch.voices['speakers'][line['voice']]
    return {
        'voice_id': sp['voice_id'],
        'model': model or sp.get('model') or ch.voices['model'],
        'settings': sp.get('settings') or ch.voices.get('settings'),
        'seed': sp.get('seed', ch.voices.get('seed')),
        'language': ch.voices.get('language', ch.lang),
        'lufs': sp.get('lufs', -18),
    }


def all_lines(scenes: dict):
    for sc in scenes['scenes']:
        for sh in sc['shots']:
            for i, ln in enumerate(sh['lines']):
                yield sc, sh, i, ln


def loudness(path) -> float:
    r = subprocess.run(['ffmpeg', '-hide_banner', '-nostats', '-i', str(path), '-af', 'ebur128=framelog=quiet', '-f', 'null', '-'],
                       capture_output=True, text=True, encoding='utf-8', errors='replace')
    m = re.findall(r'I:\s*(-?[\d.]+|-inf)\s*LUFS', r.stderr)
    return float(m[-1]) if m and m[-1] != '-inf' else -70.0


def char_times(sent: str, al: dict, dur: float):
    """Character timings of the displayed text (without tags): [[char, start, end], …]."""
    chars = al.get('characters') if al else None
    st = al.get('character_start_times_seconds') if al else None
    en = al.get('character_end_times_seconds') if al else None
    if not chars or len(chars) != len(sent):
        # alignment does not match the text — evenly over the characters (marked in the report)
        n = max(1, len(sent))
        st = [dur * i / n for i in range(n)]
        en = [dur * (i + 1) / n for i in range(n)]
    out, depth = [], 0
    for i, c in enumerate(sent):
        if c == '[':
            depth += 1
        if depth == 0:
            out.append([c, round(st[i], 3), round(en[i], 3)])
        if c == ']':
            depth = max(0, depth - 1)
    # displayed text: collapse spaces the same way as display_text
    res = []
    for c in out:
        if c[0].isspace() and (not res or res[-1][0].isspace()):
            continue
        res.append(c)
    while res and res[0][0].isspace():
        res.pop(0)
    while res and res[-1][0].isspace():
        res.pop()
    return res, bool(chars and len(chars) == len(sent))


def speech_span(ct):
    sp = [c for c in ct if re.match(r'[\w\uac00-\ud7a3]', c[0])]
    if not sp:
        return 0.0, ct[-1][2] if ct else 0.0
    return sp[0][1], sp[-1][2]


def estimate(line: dict, ch: Channel) -> float:
    n = len(re.findall(r'[\uac00-\ud7a3A-Za-z0-9]', display_text(line['text'])))
    pauses = len(re.findall(r'[.,?!…]', line['text']))
    return n / ch.cfg['timing']['est_syllables_per_sec'] + 0.25 * pauses


def run(scenes: dict, wd: Path, ch: Channel, go=False, est=False, model=None):
    """Returns {(shot, i): clip} and writes voice/index.json."""
    vdir = wd / 'voice'
    vdir.mkdir(parents=True, exist_ok=True)
    repeat = ch.voices.get('repeat_tags', True)
    todo, clips = [], {}
    for sc, sh, i, ln in all_lines(scenes):
        vc = voice_cfg(ch, ln, model)
        sent = tts_text(ln, repeat)
        key = sha(vc['model'], vc['voice_id'], vc['settings'], vc['seed'], vc['language'], sent)[:12]
        base = vdir / f'{sh["id"].replace(".", "-")}_{i}_{key}'  # no dot: Path.with_suffix cut the name at "01.02"
        meta = Path(f'{base}.json')
        cid = f'{sh["id"]}#{i}'
        if meta.exists() and Path(f'{base}.mp3').exists():
            clips[cid] = load_json(meta)
            continue
        if est:
            d = estimate(ln, ch)
            disp = display_text(ln['text'])
            n = max(1, len(disp))
            clips[cid] = {'id': cid, 'file': None, 'estimate': True, 'speaker': ln['voice'], 'text': disp, 'duration': d,
                          'onset': 0.0, 'offset': d, 'chars': [[c, d * k / n, d * (k + 1) / n] for k, c in enumerate(disp)]}
            continue
        todo.append((cid, ln, vc, sent, base))
    if todo and not est:
        chars = sum(len(t[3]) for t in todo)
        rate = ch.voices.get('credits_per_char', {})
        cred = sum(len(t[3]) * rate.get(t[2]['model'], 0.44) for t in todo)
        log(f'speech: new lines {len(todo)}, characters {chars}, ≈ {cred:.0f} credits')
        if not go:
            raise PipelineError(f'TTS not started: {len(todo)} new lines (≈ {cred:.0f} credits). Run with --go, '
                                f'without speech — --estimate')
        from lib import eleven
        for cid, ln, vc, sent, base in todo:
            mp3 = Path(f'{base}.mp3')
            try:
                al = eleven.tts_timed(vc['voice_id'], sent, str(mp3), model=vc['model'], settings=vc['settings'],
                                      language=vc['language'], seed=vc['seed'])
            except RuntimeError as e:
                raise PipelineError(f'ElevenLabs, line {cid}: {e}')
            dur = probe_duration(mp3)
            ct, exact = char_times(sent, al, dur)
            on, off = speech_span(ct)
            clip = {'id': cid, 'file': mp3.name, 'speaker': ln['voice'], 'voice_id': vc['voice_id'], 'model': vc['model'],
                    'sent': sent, 'text': display_text(ln['text']), 'duration': round(dur, 3), 'onset': round(on, 3),
                    'offset': round(off, 3), 'aligned': exact, 'lufs': round(loudness(mp3), 2), 'target_lufs': vc['lufs'], 'chars': ct}
            save_json(f'{base}.json', clip)
            clips[cid] = clip
            log(f'  {cid} {ln["voice"]}: {dur:.2f} s, speech {on:.2f}–{off:.2f}' + ('' if exact else ' (character timings — even)'))
    save_json(vdir / 'index.json', clips)
    return clips
