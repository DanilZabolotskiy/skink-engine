"""Step 7: automatic check of the finished chapter → check/report.md (+ report.json) and frame sheets check/sheet_*.jpg.

1. Frame sheets by scene: the middle of every shot, at most 4 frames per sheet (tools/sheet.py, full resolution).
2. Speech recognition check (ElevenLabs STT over audio/speech.wav): the line text against what was recognised in its window,
   the offset of the first word start.
3. Frames without speech (a shot longer than the threshold without lines) and speech without a frame (a line runs out of its shot or
   past the end of the video); the lengths of the video, the sound and the timeline match.
4. Presets and shares against the channel rules; colour against the preset references (tools/pipeline/color_check.py); seconds of the
   climax preset class (channel.json → climax_seconds, optional); music inserts — number and length.
5. Staging (tools/pipeline/stage_check.py, docs/STAGING.md): sound without an event, state jump and jump in frame (and small),
   step pace, jitter of a static shot, sound on a still frame, layout by the frame journal (card on a head, line under the title bar,
   text not readable, step of an invisible figure, path through a prop), ambience dropout at a cut, phone voice band,
   timing in kit code → check/staging/report.md and sounds.md.
"""
import difflib
import re
from pathlib import Path

from tools.pipeline import color_check, stage_check
from tools.pipeline.common import Channel, ffmpeg, load_json, log, probe_duration, save_json
from tools.pipeline.sheets import shot_label, write_sheets


_DIG = '영일이삼사오육칠팔구'


def sino(n: int) -> str:
    """A number in Korean (Sino-Korean counting): 13 → 십삼, 2024 → 이천이십사 — this is how speech recognition writes it."""
    if n == 0:
        return '영'
    out = ''
    for v, name in ((1000, '천'), (100, '백'), (10, '십'), (1, '')):
        d, n = divmod(n, v)
        if d:
            out += ('' if d == 1 and name else _DIG[d]) + name
    return out


_TENS = ['', '열', '스물', '서른', '마흔', '쉰', '예순', '일흔', '여든', '아흔']
_ONES = ['', '한', '두', '세', '네', '다섯', '여섯', '일곱', '여덟', '아홉']  # before a counter word: 서른세 개, 두 번
_ONES_BARE = ['', '하나', '둘', '셋', '넷', '다섯', '여섯', '일곱', '여덟', '아홉']


def native(n: int, bare: bool = False) -> str | None:
    """A number in native Korean counting (1–99): 33 → 서른세 (before a counter word) or 서른셋 (on its own); 20 → 스무 / 스물.
    Otherwise None."""
    if not 0 < n < 100:
        return None
    t, o = divmod(n, 10)
    if n == 20 and not bare:
        return '스무'
    return _TENS[t] + (_ONES_BARE if bare else _ONES)[o]


def norm(s: str, lang: str = 'ko', ref: str = '') -> str:
    """Text for comparison with the recognised one: letters only; for Korean digits become words (recognition writes "13번" as "십삼번").
    Every number is read in the counting the line text ref uses: Sino-Korean (십삼), native before a counter word (recognition writes
    "서른세 개" as "33개", "아홉 시" as "9시") or native on its own (서른셋); without ref or without a match — Sino-Korean (a line with
    "33개" was heard right but scored 0.79 against "삼십삼"). A reading is matched together with the text next to the digits — the
    counter word after them, else the word before them: a one-syllable reading (일, 이, 사, 두…) alone is found in ordinary words and
    particles of almost any line; with no context match — the longest reading found in ref."""
    if lang != 'ko':  # other languages: letters and digits only, case-insensitive
        return re.sub(r'[\W_]', '', (s or '').lower())
    src = s or ''

    def word(m):
        n = int(m.group(0))
        cands = [w for w in (sino(n), native(n), native(n, True)) if w]
        if ref:
            pre = re.sub(r'[^가-힣a-zA-Z]', '', src[:m.start()])[-2:]
            suf = re.sub(r'[^가-힣a-zA-Z]', '', src[m.end():])[:2]
            forms = ([lambda w, k=k: w + suf[:k] for k in (2, 1) if len(suf) >= k]
                     + [lambda w, k=k: pre[-k:] + w for k in (2, 1) if len(pre) >= k] + [lambda w: w])
            for form in forms:
                hit = [w for w in cands if form(w) in ref]
                if hit:
                    return max(hit, key=len)
        return sino(n)
    return re.sub(r'[^가-힣0-9a-zA-Z]', '', re.sub(r'\d{1,4}', word, src))


def sheets(tl: dict, mp4: Path, cd: Path):
    """Frame sheets of the video: the middle of every shot (fraction 0.55), up to 4 shots per sheet, by scene."""
    fdir = cd / 'frames'
    fdir.mkdir(parents=True, exist_ok=True)
    png, label = {}, {}
    for s in tl['shots']:
        tm = s['start'] + 0.55 * (s['end'] - s['start'])
        png[s['id']] = fdir / f'{s["id"]}.png'
        ffmpeg('-ss', f'{tm:.3f}', '-i', mp4, '-frames:v', '1', png[s['id']])
        line = next((ln['text'] for ln in tl['lines'] if ln['shot'] == s['id']), '')
        label[s['id']] = shot_label(s, tm) + (f' · {line[:24]}' if line else '')
    return write_sheets(tl['shots'], png, label, cd)


def stt_check(tl: dict, wd: Path, ch: Channel, run_stt: bool):
    lines = [ln for ln in tl['lines'] if ln['file']]
    if not lines:
        return {'skipped': 'no speech (estimated durations)'}
    sp = wd / 'audio' / 'speech.wav'
    cache = wd / 'check' / 'stt.json'
    if cache.exists() and cache.stat().st_mtime > sp.stat().st_mtime:
        res = load_json(cache)
    elif run_stt:
        from lib import eleven
        mp3 = wd / 'check' / 'speech.mp3'
        ffmpeg('-i', sp, '-c:a', 'libmp3lame', '-b:a', '64k', mp3)
        res = eleven.stt(str(mp3), language=ch.lang)
        save_json(cache, res)
    else:
        return {'skipped': 'speech recognition off (--no-stt)'}
    # A word right after an audio event of the recognition ("[heavy breathing]") could sound anywhere inside the event: recognition pins it
    # to the end of the event (a breath event covered a line, and the word was written at the start of the next line). lo — the earliest
    # possible start of the word
    words, ev = [], None
    for w in res.get('words', []):
        kind = w.get('type', 'word')
        if kind == 'audio_event':
            ev = w
        elif kind == 'word':
            near = ev is not None and w['start'] - ev['end'] <= 0.15
            words.append({**w, 'lo': ev['start'] if near else w['start']})
            ev = None
    rows = []
    cfg = ch.cfg['check']
    # every word goes to one line: the one whose span it overlaps the most, else the one nearest to the middle of the word.
    # Recognition stretches the tail of the last word before a pause up to the next sound: the middle of such a word leaves the line,
    # but the overlap stays
    def dist(w, ln):
        m = (w['start'] + w['end']) / 2
        return 0.0 if ln['start'] <= m <= ln['end'] else min(abs(m - ln['start']), abs(m - ln['end']))

    def overlap(w, ln):
        return min(w['end'], ln['end']) - max(w['lo'], ln['start'])
    own = {}
    for w in words:
        best = max(lines, key=lambda ln: overlap(w, ln))
        if overlap(w, best) <= 0:
            best = min(lines, key=lambda ln: dist(w, ln))
            if dist(w, best) >= 0.6:
                continue
        own.setdefault(best['id'], []).append(w)
    for ln in lines:
        ws = own.get(ln['id'], [])
        got = ''.join(w['text'] for w in ws)
        want = norm(ln['text'], ch.lang)
        ratio = difflib.SequenceMatcher(None, want, norm(got, ch.lang, want)).ratio()
        off = None if not ws else 0.0 if ws[0]['lo'] <= ln['start'] <= ws[0]['start'] else ws[0]['start'] - ln['start']
        bad = ratio < cfg['stt_min_ratio'] or off is None or abs(off) > cfg['stt_max_offset']
        rows.append({'id': ln['id'], 'speaker': ln['speaker'], 'ratio': round(ratio, 2), 'offset': None if off is None else round(off, 2),
                     'text': ln['text'], 'heard': got.strip(), 'bad': bad})
    return {'rows': rows, 'bad': sum(r['bad'] for r in rows), 'n': len(rows)}


def run(tl: dict, wd: Path, ch: Channel, mp4: Path, run_stt=True, make_sheets=True):
    cd = wd / 'check'
    cd.mkdir(parents=True, exist_ok=True)
    rep = {'warnings': tl.get('warnings', [])}
    errs = []
    # lengths
    dv = probe_duration(wd / 'render' / 'video.mp4') if (wd / 'render' / 'video.mp4').exists() else None
    da = probe_duration(wd / 'audio' / 'mix.wav') if (wd / 'audio' / 'mix.wav').exists() else None
    dm = probe_duration(mp4) if mp4.exists() else None
    rep['durations'] = {'timeline': tl['duration'], 'video': dv, 'audio': da, 'mp4': dm}
    for k, v in (('video', dv), ('audio', da)):
        if v is not None and abs(v - tl['duration']) > 1.5 / tl['fps']:
            errs.append(f'length of {k} {v:.3f} s ≠ timeline {tl["duration"]:.3f} s')
    # speech without a frame and frames without speech
    shots = {s['id']: s for s in tl['shots']}
    for ln in tl['lines']:
        s = shots[ln['shot']]
        if ln['start'] < s['start'] - 1e-3 or ln['end'] > s['end'] + 1e-3:
            errs.append(f'speech without a frame: {ln["id"]} {ln["start"]:.2f}–{ln["end"]:.2f} outside the shot {s["start"]:.2f}–{s["end"]:.2f}')
        if ln['end'] > tl['duration'] + 1e-3:
            errs.append(f'speech after the end of the video: {ln["id"]}')
    silent = []
    for s in tl['shots']:
        if not any(ln['shot'] == s['id'] for ln in tl['lines']) and s['end'] - s['start'] > ch.cfg['check']['silent_shot_sec']:
            silent.append(f'{s["id"]} ({s["end"] - s["start"]:.1f} s)')
    rep['silent_shots'] = silent
    # presets
    tot = {}
    for s in tl['shots']:
        tot[s['category']] = tot.get(s['category'], 0) + s['end'] - s['start']
    dur = tl['duration']
    share = {k: round(v / dur, 3) for k, v in tot.items()}
    rng = ch.cfg['preset_share']
    rep['presets'] = {k: {'sec': round(tot.get(k, 0), 1), 'share': share.get(k, 0), 'rule': rng[k]} for k in rng}
    rep['climax_sec'] = round(tot.get('climax', 0), 1)
    climax = ch.cfg.get('climax_seconds')  # [min, max] seconds of the climax preset class per chapter
    if climax and not climax[0] <= rep['climax_sec'] <= climax[1]:
        errs.append(f'climax: {rep["climax_sec"]} s in the chapter, the channel rule is {climax[0]}–{climax[1]} s (channel.json → climax_seconds)')
    # music
    mc = ch.music
    rep['music'] = [{'shot': m['shot'], 'mood': m['mood'], 'pick': m['pick'], 'track': m['track'], 'src': m['src'], 'dur': m['dur']} for m in tl['music']]
    if len(tl['music']) > mc['max_per_chapter']:
        errs.append(f'music inserts {len(tl["music"])} > {mc["max_per_chapter"]}')
    rep['sfx_missing'] = sorted({s['id'] for s in tl['sfx'] if s.get('id') and not s['file']})  # not from the library — silence, not an error
    rep['stt'] = stt_check(tl, wd, ch, run_stt)
    if 'rows' in rep['stt']:
        for r in rep['stt']['rows']:
            if r['bad']:
                errs.append(f'speech recognition {r["id"]}: similarity {r["ratio"]}, offset {r["offset"]} — "{r["heard"][:40]}"')
    # staging: events, sound by events, jumps and jitter by frames
    tlp = wd / 'timeline.json'
    old = mp4.exists() and tlp.exists() and mp4.stat().st_mtime < tlp.stat().st_mtime
    rep['staging'] = stage_check.run(tl, wd, ch.cfg, mp4, note='- **The video is older than timeline.json: frames were checked against an old render — rebuild the chapter.**' if old else '', ch=ch)
    errs += [f'staging — {e}' for e in rep['staging']['list']]
    errs += [f'environment (not staging, repeat the run) — {e}' for e in rep['staging']['env']]
    # colour: comparison with the preset references (error — the preset median out of tolerance, a frame of a graded
    # preset without the grade)
    rep['color'] = color_check.run(tl, wd, mp4, reference=ch.colors)
    errs += rep['color']['errors']
    rep['sheets'] = [p.name for p in sheets(tl, mp4, cd)] if make_sheets and mp4.exists() else []
    rep['errors'] = errs
    save_json(cd / 'report.json', rep)
    md = [f'# Chapter check · {tl.get("title", "")}', '',
          f'- Length: timeline {dur:.2f} s, video {dv}, sound {da}, mp4 {dm}',
          f'- Errors: {len(errs)}' + ''.join(f'\n  - {e}' for e in errs),
          f'- Frames without speech (> {ch.cfg["check"]["silent_shot_sec"]} s): {", ".join(silent) or "none"}',
          '- Presets (episode shares by the channel rules; for a chapter — for information): ' + '; '.join(
              f'{k} {v["sec"]} s = {v["share"] * 100:.0f} % (rule {v["rule"][0] * 100:.0f}–{v["rule"][1] * 100:.0f} %)' for k, v in rep['presets'].items()),
          f'- Climax: {rep["climax_sec"]} s' + (f' (rule {climax[0]}–{climax[1]} s)' if climax else ''),
          f'- Music: {len(tl["music"])} inserts (≤ {mc["max_per_chapter"]})' + ''.join(f'{"; " if i else ": "}{m["shot"]} {m["mood"]} → {m["track"]}@{m["src"]} {m["dur"]} s'
                                                                         for i, m in enumerate(tl['music'])),
          f'- Library sounds not generated yet (silence): {", ".join(rep["sfx_missing"]) or "—"} → audio/sfx_missing.md, the full list and the estimate — audio/sfx_needed.md (tools/pipeline/sfx_list.py)']
    md += [f'- Staging: errors {rep["staging"]["errors"]}, motion by script words {rep["staging"]["todo"]}, manual sound bindings {rep["staging"]["manual"]} → check/staging/report.md, sounds.md']
    md += color_check.md(rep['color'])
    st = rep['stt']
    if 'rows' in st:
        md += ['', f'## Speech recognition: {st["n"] - st["bad"]} of {st["n"]} lines are fine', '', '| Line | Voice | Similarity | Offset, s | Text | Recognised |', '|---|---|---|---|---|---|']
        md += [f'| {r["id"]} | {r["speaker"]} | {r["ratio"]} | {r["offset"]} | {r["text"]} | {r["heard"]} |' for r in st['rows']]
    else:
        md += [f'- Speech recognition: {st.get("skipped")}']
    if rep['warnings']:
        md += ['', '## Warnings', ''] + [f'- {w}' for w in rep['warnings']]
    md += ['', '## Sheets', ''] + [f'- check/{n}' for n in rep['sheets']]
    (cd / 'report.md').write_text('\n'.join(md) + '\n', encoding='utf-8')
    log(f'check: errors {len(errs)}, frames without speech {len(silent)}, sheets {len(rep["sheets"])}' +
        (f', speech recognition {st["n"] - st["bad"]}/{st["n"]}' if 'rows' in st else '') + f' → {cd / "report.md"}')
    return rep
