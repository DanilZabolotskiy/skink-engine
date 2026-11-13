"""List of chapter sounds and an estimate: the script (SFX lines) × the channel library pipeline/sfx.json → audio/sfx_needed.md of the chapter.

python tools/pipeline/sfx_list.py <script.md> [--lang en] [--work DIR]

Every script sound finds library entries by id or match; ignore marks are not sounds; the rest is silence. If the work folder already
has timeline.json (the timeline step), the sounds of staging events (steps, a door, a stamp) and the place beds count too.
The estimate covers planned (not yet generated sounds of the library): one call per sound,
credits = seconds × credits_per_second. Music inserts — a table of track pieces. Generates nothing.
"""
import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from tools.pipeline import parse, timeline  # noqa: E402
from tools.pipeline.common import Channel, PipelineError, channel_dir, episode_of, load_json, rel, work_dir  # noqa: E402


def music_rows(sc: dict, ch: Channel):
    rows, t = [], 0.0
    for s in sc['scenes']:
        for sh in s['shots']:
            for m in sh['music']:
                lr = ch.music['len_range']
                d = min(max(m['dur'] or 6.0, lr[0]), lr[1])
                if m['src']:
                    tr, a0, pick = m['src']['track'], m['src']['at'], 'manual'
                else:
                    mood = timeline.pick_mood(m['mood'], ch.music['moods']) or (ch.music['moods'][0] if ch.music['moods'] else None)
                    if mood is None:
                        raise PipelineError(f'{sh["id"]}: music.json has no moods')
                    tr, pick = mood['track'], mood['id']
                    a0 = mood['at'] if mood['anchor'] == 'start' else mood['at'] - d
                a0 = max(0.0, min(a0, 60.0 - d))
                rows.append((sh['id'], t + m['at'], m['mood'], pick, tr, a0, d))
            t += sh['planned']
    return rows


def run(script: Path, lang: str, wd: Path | None):
    ch = Channel(channel_dir(script), episode_of(script))
    sc = parse.parse(script, ch, lang)
    lib = ch.sfx
    rate = lib.get('credits_per_second', 40)
    used, ignored, missing = {}, {}, {}
    for s in sc['scenes']:
        for sh in s['shots']:
            for x in sh['sfx']:
                kind, hits = timeline.classify_sfx(x['name'], lib)
                if kind == 'ignore':
                    ignored.setdefault(x['name'], []).append(sh['id'])
                elif kind == 'missing':
                    missing.setdefault(x['name'], []).append(sh['id'])
                for h in hits:
                    u = used.setdefault(h, {'shots': [], 'names': set()})
                    u['shots'].append(sh['id'])
                    u['names'].add(x['name'])
    if wd is None:
        wd = work_dir(script, lang or ch.lang, ch)
    if (wd / 'timeline.json').exists():
        tl = load_json(wd / 'timeline.json')
        for x in tl['sfx']:
            if x.get('id'):
                used.setdefault(x['id'], {'shots': [], 'names': set()})['shots'].append(x['shot'])
        for sh in tl['shots']:
            if sh.get('bed'):
                used.setdefault(sh['bed'], {'shots': [], 'names': set()})['shots'].append(sh['id'])
    planned = lib.get('planned', {})
    ready = lib.get('sounds', {})
    allk = list(planned) + [k for k in ready if k not in planned]
    todo = [k for k in planned if k not in ready]
    sec = sum(planned[k]['seconds'] for k in todo)
    md = [f'# Sounds · {sc.get("title", "")}', '',
          f'Channel library (`pipeline/sfx.json`): **{len(allk)} sounds**, {len(ready)} ready, {len(todo)} to generate. '
          f'{len(used)} of them sound in this chapter. Script: `{rel(script)}`.', '',
          f'**ElevenLabs Sound Effects estimate** — one call per sound, {rate} credits per second of the set duration '
          f'(see the ElevenLabs sound effects docs): **{len(todo)} calls, {sec:g} s, {round(sec * rate):,} credits**.', '',
          'Generation — only on the owner\'s command. Beds (loops) are generated with the loop flag and run in the mix until the end of the scene. '
          'A sound only where the viewer will notice it.', '',
          '| id | Group | What it is (EN prompt) | s | Loop | Chapter shots |', '|---|---|---|---|---|---|']
    for k in allk:
        e = planned.get(k) or ready[k]
        shots = ', '.join(sorted(set(used[k]['shots']))) if k in used else '—'
        md.append(f'| `{k}` | {e.get("group", "")} | {e.get("prompt", e.get("file", ""))} | {e.get("seconds", "—")} | {"yes" if e.get("loop") else "—"} | {shots} |')
    md.append('')
    if missing:
        md += ['## Not in the library — silence in the mix', ''] + [f'- {n} — {", ".join(v)}' for n, v in sorted(missing.items())] + ['']
    if ignored:
        md += ['## Marks, not sounds', ''] + [f'- {n} — {", ".join(v)}' for n, v in sorted(ignored.items())] + ['']
    rows = music_rows(sc, ch)
    md += ['## Music inserts — what to listen to', '',
           'Pieces are cut from the tracks (`assets/music/`). Time in the chapter — by the planned durations of the script, '
           'exact — after TTS (timeline.json). The segments in music.json are marked by loudness and spectrum, not checked by ear.', '',
           '| Shot | ≈ time in the chapter | Mood in the script | music.json segment | Track | Track piece | Length |', '|---|---|---|---|---|---|---|']
    for sid, t, mood, pick, tr, a0, d in rows:
        md.append(f'| {sid} | {int(t // 60)}:{t % 60:04.1f} | {mood} | {pick} | {tr} ({ch.music["tracks"][tr]["file"].split("/")[-1]}) | {a0:.1f}–{a0 + d:.1f} s | {d:g} s |')
    out = wd / 'audio' / 'sfx_needed.md'
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text('\n'.join(md) + '\n', encoding='utf-8')
    print(f'library {len(allk)} sounds (to generate {len(todo)}: {sec:g} s, {sec * rate:.0f} credits); {len(used)} of them in the chapter; '
          f'not in the library (silence) {len(missing)}; music {len(rows)} → {rel(out)}')
    return out


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('script')
    ap.add_argument('--lang')
    ap.add_argument('--work')
    a = ap.parse_args()
    try:
        run(Path(a.script), a.lang, Path(a.work).resolve() if a.work else None)
    except PipelineError as e:
        sys.exit(f'ERROR: {e}')
