"""Chapter colour against the preset references of the channel (check step, a section of check/report.md).

python tools/pipeline/color_check.py <chapter work folder> [--video <ch.mp4> | --stills "<folder>/c_{frame}.png"] [--shots 01.01,02.01] [--out <folder>]
python tools/pipeline/color_check.py --reference <channels/<channel>>   — recompute the references from the reference frames (if they are on disk) and print them

Measurement (tools/color_stats.py): a shot frame at fraction 0.55, a band of 5–82 % of the height, width 320. The comparison is against a
reference measured the same way (channel config pipeline/colors.json), not against numbers from style notes.
- Error: the preset median (over the kits present in the reference) differs from the reference median by more than the tolerance TOL;
  a frame of a graded preset whose light planes are colourful (S of light planes > slight_max: the grade was not applied).
- Information: a shot outside the spread of the reference frames with the margin MARGIN (a close-up of a colourful prop, a dark corner).
- A reference with the status "question" — differences only as information.
"""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from tools.color_stats import band_pixels, shot_frames, stats, video_frame  # noqa: E402
from tools.pipeline.common import chapter_video, channel_of_work  # noqa: E402

KEYS = ('S', 'sY', 'C', 'acc')
TOL = {'S': 0.04, 'sY': 0.04, 'C': 8.0, 'black': 15.0, 'gray': 15.0, 'red': 4.0}  # tolerance of the preset median to the reference median
MARGIN = {'S': 0.05, 'sY': 0.05, 'C': 12.0, 'acc': 5.0}  # margin to the spread of the reference frames (information per shot)

# Reference stats per preset: channel config pipeline/colors.json → "reference" (Channel.colors). Without it the colour check is skipped.
# Entry: {"src": "<where the reference frames are>", "status": "accepted" | "question", "kits": [<kit>…] | null,
#         "med": {S, sY, C, acc}, "lo": {…}, "hi": {…}, "extra": ["black", "gray", "red"] (optional),
#         "slight_max": 0.13 (optional: the limit of S of light planes, Y > 0.7, for a graded preset)}
# "files" (optional): reference frames for --reference, paths from the channel root ("GLOB:<pattern>" — a glob).


def measure(im: Image.Image) -> dict:
    """Frame metrics: color_stats.stats over the band + S of light planes + black / grey / red shares."""
    px = band_pixels(im)
    st = stats(px)
    mx, mn = px.max(1), px.min(1)
    s = np.where(mx > 1e-6, (mx - mn) / np.maximum(mx, 1e-6), 0)
    y = 0.2126 * px[:, 0] + 0.7152 * px[:, 1] + 0.0722 * px[:, 2]
    # light planes — light and low-saturated: a yellow sticker in close-up (S ~0.7) is an accent, measured by "Accent", not by the grade
    light = (y > 0.7) & (s < 0.5)
    p = np.round(px * 255).astype(int)
    r, g, b, m8 = p[:, 0], p[:, 1], p[:, 2], p.max(1)
    return {**{k: st[k] for k in KEYS}, 'dark': st['dark'], 'Y': st['Y'], 'rgb': st['rgb'],
            'Sl': float(s[light].mean()) if light.any() else 0.0,
            'black': float((m8 <= 3).mean() * 100),
            'gray': float(((abs(r - g) <= 3) & (abs(g - b) <= 3) & (m8 >= 4) & (m8 <= 64)).mean() * 100),
            'red': float(((r > 150) & (g < 60) & (b < 70)).mean() * 100)}


def run(tl: dict, wd: Path, mp4: Path | None = None, stills: str | None = None, shots=None, at=(0.55,), reference: dict | None = None) -> dict:
    """Measure the shots and compare with the references. Frames — clean stills (c_{frame}.png) or from the chapter video."""
    size = (tl.get('width', 1920), tl.get('height', 1080))
    refs = reference or {}

    def frame(f):
        if stills:
            p = Path(stills.replace('{frame}', str(f)))
            return Image.open(p) if p.exists() else None
        return video_frame(mp4, (f + 0.5) / tl['fps'], size) if mp4 and Path(mp4).exists() else None

    rows, errors, info = [], [], []
    for s in tl['shots']:
        if s['preset'] not in refs or (shots and s['id'] not in shots):
            continue
        per = [measure(im) for im in (frame(f) for f in shot_frames(s, at)) if im is not None]
        if not per:
            continue
        row = {'shot': s['id'], 'preset': s['preset'], 'kit': s.get('kit'), 'view': s.get('view'),
               **{k: float(np.median([p[k] for p in per])) for k in per[0] if k != 'rgb'}, 'rgb': per[0]['rgb']}
        rows.append(row)
        et = refs[s['preset']]
        if et.get('slight_max') is not None and row['Sl'] > et['slight_max']:
            errors.append(f'colour {s["id"]}: light planes S {row["Sl"]:.2f} > {et["slight_max"]} — the preset colour grade was not applied')
        if et['kits'] is None or row['kit'] in et['kits']:
            out = [f'{k} {row[k]:.2f}' if k in ('S', 'sY') else f'{k} {row[k]:.0f}' for k in KEYS
                   if row[k] < et['lo'][k] - MARGIN[k] and k != 'acc' or row[k] > et['hi'][k] + MARGIN[k]]
            if out:
                info.append(f'{s["id"]} ({s["preset"]}, {row["kit"]}/{row["view"]}): outside the reference spread — {", ".join(out)}')
    presets = {}
    for pr, et in refs.items():
        grp = [r for r in rows if r['preset'] == pr]
        cmp_ = [r for r in grp if et['kits'] is None or r['kit'] in et['kits']]
        if not grp:
            continue
        keys = list(KEYS) + list(et.get('extra', []))
        med_all = {k: float(np.median([r[k] for r in grp])) for k in keys}
        med = {k: float(np.median([r[k] for r in cmp_])) for k in keys} if cmp_ else {}
        bad = [k for k in keys if k in TOL and med and abs(med[k] - et['med'][k]) > TOL[k]]
        presets[pr] = {'n': len(grp), 'n_cmp': len(cmp_), 'med': med, 'med_all': med_all, 'reference': et['med'], 'bad': bad, 'status': et['status']}
        if bad:
            msg = f'colour {pr}: the shot median ({", ".join(et["kits"] or ["all kits"])}, {len(cmp_)}) differs from the reference — ' + ', '.join(
                f'{k} {med[k]:.2f} against {et["med"][k]:.2f} ± {TOL[k]}' for k in bad)
            (errors if et['status'] == 'accepted' else info).append(msg + ('' if et['status'] == 'accepted' else ' (the reference is a question to the owner)'))
    return {'rows': rows, 'presets': presets, 'errors': errors, 'info': info, 'at': list(at)}


def md(rep: dict) -> list:
    """Lines for check/report.md."""
    if not rep['presets']:
        return []  # no references for the presets of the chapter (pipeline/colors.json)
    f = lambda k, v: f'{v:.2f}' if k in ('S', 'sY') else f'{v:.0f}' if k == 'C' else f'{v:.1f}'
    out = ['', '## Colour against the preset references (tools/pipeline/color_check.py)', '',
           f'- Errors: {len(rep["errors"])}' + ''.join(f'\n  - {e}' for e in rep['errors']), '',
           '| Preset | Shots (compared) | S | σY | Colorf. | Accent, % | Reference: S / σY / Colorf. / accent | Reference status |', '|---|---|---|---|---|---|---|---|']
    for pr, p in rep['presets'].items():
        m = p['med'] or p['med_all']
        e = p['reference']
        out.append(f'| {pr} | {p["n"]} ({p["n_cmp"]}) | ' + ' | '.join(f(k, m[k]) for k in KEYS) + ' | ' + ' / '.join(f(k, e[k]) for k in KEYS) +
                   (f'; black / grey / red {f("", m["black"])} / {f("", m["gray"])} / {f("", m["red"])} % against {f("", e["black"])} / {f("", e["gray"])} / {f("", e["red"])} %' if 'black' in m else '') +
                   f' | {"accepted" if p["status"] == "accepted" else "question"} |')
    if rep['info']:
        out += ['', 'Information (not errors):'] + [f'- {x}' for x in rep['info']]
    return out


def reference_recalc(cdir: Path, reference: dict):
    import glob
    for pr, files in ((k, v['files']) for k, v in reference.items() if v.get('files')):
        paths = sorted(glob.glob(str(cdir / files[5:]))) if isinstance(files, str) else [str(cdir / p) for p in files]
        paths = [p for p in paths if Path(p).exists()]
        if not paths:
            print(pr, ': no reference frames on disk'); continue
        ms = [measure(Image.open(p)) for p in paths]
        keys = list(KEYS) + list(reference[pr].get('extra', [])) + (['Sl'] if reference[pr].get('slight_max') is not None else [])
        print(pr, len(ms), 'med', {k: round(float(np.median([m[k] for m in ms])), 2) for k in keys})
        print('   lo', {k: round(min(m[k] for m in ms), 2) for k in KEYS}, 'hi', {k: round(max(m[k] for m in ms), 2) for k in KEYS})


if __name__ == '__main__':
    a = sys.argv[1:]
    opt = lambda k, d=None: a[a.index(k) + 1] if k in a else d
    if '--reference' in a:
        cdir = Path(opt('--reference')).resolve()
        reference_recalc(cdir, json.loads((cdir / 'pipeline' / 'colors.json').read_text(encoding='utf-8')).get('reference', {}))
        sys.exit(0)
    wd = Path(a[0]).resolve()
    tl = json.loads((wd / 'timeline.json').read_text(encoding='utf-8'))
    video = Path(opt('--video')) if opt('--video') else chapter_video(wd)
    video = video if video.exists() else None
    cdir = channel_of_work(wd, tl)
    refs = json.loads((cdir / 'pipeline' / 'colors.json').read_text(encoding='utf-8')).get('reference', {}) if cdir and (cdir / 'pipeline' / 'colors.json').exists() else {}
    rep = run(tl, wd, video, opt('--stills'), opt('--shots').split(',') if opt('--shots') else None, reference=refs)
    od = Path(opt('--out')) if opt('--out') else wd / 'check'
    od.mkdir(parents=True, exist_ok=True)
    (od / 'color.json').write_text(json.dumps(rep, ensure_ascii=False, indent=1), encoding='utf-8')
    (od / 'color.md').write_text('\n'.join(md(rep)).lstrip() + '\n', encoding='utf-8')
    print('\n'.join(md(rep)))
