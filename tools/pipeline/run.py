"""Chapter pipeline: script → finished video 1920×1080 30 fps. Description — docs/PIPELINE.md.

python tools/pipeline/run.py <script.md | chapter folder> [--lang en] [--steps all] [--go] [--estimate]
       [--until 120] [--scenes 01,02] [--model eleven_v4] [--concurrency 4] [--style western] [--no-stt] [--force-render] [--work DIR]
       [--no-guard] [--no-precheck] [--no-hands]
python tools/pipeline/run.py episode <episodes/s01e01/en> [--out FILE]   — the episode master 1920×1080: the chapters joined + sound (mix.wav → AAC 192k)
python tools/pipeline/run.py episode <episodes/s01e01/en> --4k [--chapters 01,02] [--batch 5400] [--concurrency 4] [--force-render]
       — a 3840×2160 CRF 18 master: the chapters are rendered anew with scale 2 (not an upscale) into <episode>/master4k/chNN/;
         --chapters — only the render of these chapters, no joining; --batch — frames per place in the CPU queue

Steps: parse, voice, timeline, precheck, render, audio, assemble, check, guard (by default all in order).
precheck — staging checks before render on frames drawn from code (tools/pipeline/precheck.py → check/precheck/report.md): with errors
the pipeline stops before render; --no-precheck — without it. With --scenes and without the render step (the edit loop: --steps
parse,timeline,precheck) the timeline is built for the whole chapter (frames and times as in the full chapter), precheck runs only on
the shots of these scenes.
guard — accepted chapters against their videos (tools/guard.py, docs/PIPELINE.md "Accepted chapters guard") — only those whose frames the
uncommitted edit touches (tools/lane.py: shared code — all of them, a kit — the chapters with that kit; new files of a chapter — none): the
edits made for this chapter did not change the accepted ones; without the lane hook (git config core.hooksPath tools/hooks) committed edits
were never guarded, so every accepted chapter; --no-guard — without it. The work folder of an accepted chapter is the guard
reference: the pipeline does not write into it (SKINK_UNFREEZE=1 — the owner's decision).
--go — allow paid TTS of new lines (without it the estimate is printed and the pipeline stops);
--estimate — no TTS: durations from the text length, silent speech (checks the picture and the timing).
"""
import argparse
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from tools.pipeline import audio, check, parse, precheck, render, timeline, voice  # noqa: E402
from tools.pipeline.common import (ROOT, Channel, PipelineError, accepted_dirs, channel_dir, chapter_video, episode_of, ffmpeg, load_json, log, rel,  # noqa: E402
                                   save_json, style_ids, work_dir)

STEPS = ['parse', 'voice', 'timeline', 'precheck', 'render', 'audio', 'assemble', 'check', 'guard']


def chapter(a):
    ch = Channel(channel_dir(Path(a.script) / 'script.md' if Path(a.script).is_dir() else Path(a.script)), episode_of(a.script))
    a.lang = a.lang or ch.lang
    if a.style:
        ch.cfg['style'] = a.style  # draw the figures in another drawing style for this run
    styles = style_ids()
    if ch.cfg.get('style') not in styles:
        raise PipelineError(f'unknown drawing style {ch.cfg.get("style")!r} (channel.json → style or --style); styles: {", ".join(styles)}')
    script = parse.pick_script(Path(a.script), a.lang)
    wd = (Path(a.work) if a.work else work_dir(script, a.lang, ch)).resolve()
    if wd in {p.resolve() for p in accepted_dirs(ch.dir)} and not os.environ.get('SKINK_UNFREEZE'):
        raise PipelineError(f'{rel(wd)} is the work folder of an accepted chapter: its timeline.json and video are the guard reference, the pipeline '
                            'does not write into it. An edit of an accepted chapter — only by the owner\'s decision (SKINK_UNFREEZE=1); a trial — '
                            '--work <another folder> (docs/PARALLEL.md)')
    wd.mkdir(parents=True, exist_ok=True)
    steps = STEPS if a.steps == 'all' else [s.strip() for s in a.steps.split(',')]
    bad = [s for s in steps if s not in STEPS]
    if bad:
        raise PipelineError(f'unknown steps: {bad}; available: {STEPS}')
    out_mp4 = chapter_video(wd)
    log(f'chapter: {rel(script)} → {rel(wd)}')
    t0 = time.time()
    only = [s.strip().zfill(2) for s in a.scenes.split(',')] if a.scenes else None

    if 'parse' in steps or not (wd / 'scenes.json').exists():
        sc = parse.parse(script, ch, a.lang)
        save_json(wd / 'scenes.json', sc)
        log(f'parse: scenes {len(sc["scenes"])}, shots {sum(len(s["shots"]) for s in sc["scenes"])}' +
            ''.join(f'\n  warning: {w}' for w in sc['warnings']))
    sc = load_json(wd / 'scenes.json')
    # TTS only for what goes into the chapter (--scenes, --until by planned durations); checking scenes without render
    # (--steps …,precheck --scenes) — by the timeline of the whole chapter: the same frames, cuts and scene joints as in the full chapter
    whole = bool(only) and 'precheck' in steps and 'render' not in steps and not a.until
    if (only or a.until) and not whole:
        keep, tt = [], 0.0
        for s in sc['scenes']:
            if only and s['id'] not in only:
                continue
            shots = []
            for sh in s['shots']:
                if a.until is not None and tt >= a.until:
                    break
                shots.append(sh)
                tt += max(sh['planned'], 1.5)
            if shots:
                keep.append({**s, 'shots': shots})
        sc = {**sc, 'scenes': keep}
    build = 'timeline' in steps or not (wd / 'timeline.json').exists()
    if 'voice' in steps or build:
        clips = voice.run(sc, wd, ch, go=a.go, est=a.estimate, model=a.model)
    if build:
        tl = timeline.build(sc, clips, ch, timeline.load_staging(script), until=a.until)
        save_json(wd / 'timeline.json', tl)
        log(f'timeline: {tl["duration"]:.1f} s, shots {len(tl["shots"])}, lines {len(tl["lines"])}, subtitles {len(tl["cues"])}, '
            f'sounds {len(tl["sfx"])}, music {len(tl["music"])}' + (f', warnings {len(tl["warnings"])}' if tl['warnings'] else ''))
    tl = load_json(wd / 'timeline.json')
    if 'precheck' in steps and not a.no_precheck:
        shots = [s['id'] for s in tl['shots'] if s['scene'] in only] if only else None
        if only and not shots:
            raise PipelineError(f'precheck: the timeline has no scenes {only}')
        pr = precheck.run(tl, wd, ch, shots, hands=not a.no_hands)
        for e in pr['errors']:
            log(f'  {e}')
        for e in pr['env']:
            log(f'  ENVIRONMENT (not staging): {e}')
        if pr['errors'] or pr['env']:
            stop = ' — render not started' if 'render' in steps else ''
            raise PipelineError((f'precheck: staging errors {len(pr["errors"])}' if pr['errors'] else 'precheck: no staging errors') +
                                (f', environment failures {len(pr["env"])} (repeat the run)' if pr['env'] else '') + f'{stop} → {pr["report"]}')
    if 'render' in steps:
        render.run(tl, wd / 'timeline.json', wd, concurrency=a.concurrency, force=a.force_render)
    if 'audio' in steps:
        audio.run(tl, wd, ch)
    if 'assemble' in steps:
        audio.assemble(tl, wd / 'render' / 'video.mp4', wd / 'audio' / 'mix.wav', out_mp4)
        log(f'assembled: {rel(out_mp4)} ({tl["duration"]:.1f} s)')
    if 'check' in steps:
        check.run(tl, wd, ch, out_mp4, run_stt=not a.no_stt)
    # a trial run (--until, --scenes, --estimate) does not check accepted chapters unless the step is named explicitly
    probe = a.steps == 'all' and (a.until is not None or a.scenes or a.estimate)
    if 'guard' in steps and not a.no_guard and not probe and accepted_dirs(ch.dir):
        guard_step(ch, wd)
    log(f'done in {time.time() - t0:.0f} s')


def guard_dirs(ch: Channel) -> tuple:
    """The accepted chapters the guard step checks → ([work folders], why). With the lane hook installed (core.hooksPath tools/hooks) a
    committed engine-lane edit was guarded before its commit, so only the chapters whose frames the uncommitted edit touches (tools/lane.py).
    Without the hook (a plain checkout) or without git — every accepted chapter: a committed edit of shared code was never guarded."""
    dirs = [str(p) for p in accepted_dirs(ch.dir)]
    try:
        from tools import lane
        if not lane.hook_installed():
            return dirs, ('the lane hook is not installed (git config core.hooksPath tools/hooks), so committed edits were not guarded — every '
                          'accepted chapter')
        res = lane.analyse(argparse.Namespace(staged=False, since=None, base=None))
        hit = {c for r in res['rows'] for c in r['frames']}
        sel = [str(c['wd']) for c in res['usage'].chapters if c['label'] in hit]
        return sel, f'the uncommitted edit touches the frames of {len(sel)} of {len(res["usage"].chapters)} (tools/lane.py)'
    except (Exception, SystemExit) as e:  # no git — check them all
        return dirs, f'tools/lane.py failed ({str(e)[:120]}) — every accepted chapter'


def guard_step(ch: Channel, wd: Path):
    """Accepted chapters against their videos: control frames drawn by the current code (tools/guard.py) of the chapters guard_dirs picks.
    The report and the pair sheets go to this chapter's folder (check/guard/<accepted chapter>): the folders of the accepted chapters do not
    change."""
    dirs, why = guard_dirs(ch)
    log(f'accepted chapters guard: {why}')
    gd = wd / 'check' / 'guard'
    if gd.exists():
        shutil.rmtree(gd)  # old guard reports of this chapter are not passed off as new ones (the folder of the chapter being built)
    gd.mkdir(parents=True)
    (gd / 'report.md').write_text('# Accepted chapters guard (the guard step)\n\n' + (
        f'- Checked ({why}): {len(dirs)} — {", ".join(Path(d).name for d in dirs)}; reports — <chapter>/report.md\n' if dirs else
        '- Not needed: the uncommitted edit does not touch the frames of accepted chapters (tools/lane.py check)\n'), encoding='utf-8')
    if not dirs:
        log('accepted chapters guard: not needed')
        return
    r = subprocess.run([sys.executable, str(ROOT / 'tools' / 'guard.py'), *dirs, '--out', str(gd)], capture_output=True, text=True, encoding='utf-8',
                       errors='replace')
    err = [ln for ln in r.stderr.strip().splitlines() if not ln.startswith('mirror:')][-3:] if r.returncode else []
    for line in r.stdout.strip().splitlines() + err:
        log(f'  {line}')
    log('accepted chapters guard: ' + ('no differences' if r.returncode == 0 else 'NOT RUN — see the error above' if err else
                                     f'DIFFERENCES FOUND — pair sheets in {rel(gd)}/<chapter>/pairs (docs/PIPELINE.md, "Accepted chapters guard")'))


def episode(a):
    """The episode master: by default 1920×1080 — the finished chapters (render/video.mp4) joined without re-encoding; --4k — 3840×2160:
    the same compositions and timeline.json of the chapters anew with scale 2 (the vector frame is drawn anew, not an upscale), scene by
    scene in <episode>/master4k/chNN/ (a cache as for a chapter; the folders of accepted chapters are not touched), in chunks of --batch
    frames through the CPU queue. Video — h264 CRF 18 (render.CRF). Sound — mix.wav of the chapters (AAC 192k, the same loudness). The
    output goes to a temporary <name>.tmp.mp4 and replaces <episode>_<language>.mp4 only as a whole."""
    ed = Path(a.dir).resolve()
    chs = sorted(p for p in ed.glob('ch*/ch*.mp4'))
    if not chs:
        raise PipelineError(f'{ed} has no chapters ch*/ch*.mp4')
    if a.chapters and not a.k4:
        raise PipelineError('--chapters — only with --4k (a 4K render of these chapters)')
    vids = [p.parent / 'render' / 'video.mp4' for p in chs]
    if a.k4:
        want = {f'ch{c.strip().zfill(2)}' for c in a.chapters.split(',')} if a.chapters else None
        vids = []
        t0 = time.time()
        for p in chs:
            wd = p.parent
            rd = ed / 'master4k' / wd.name
            vids.append(rd / 'video.mp4')
            if want is not None and wd.name not in want:
                continue
            log(f'4K master: {wd.name}')
            tl = load_json(wd / 'timeline.json')
            v = render.run(tl, wd / 'timeline.json', wd, concurrency=a.concurrency, force=a.force_render, scale=2, rd=rd, batch=a.batch)
            n4, n1 = frames(v), frames(wd / 'render' / 'video.mp4')
            if n4 != n1:
                raise PipelineError(f'{rel(v)}: {n4} frames, the working chapter video has {n1}')
        log(f'4K master: render {(time.time() - t0) / 60:.1f} min')
        if want is not None:
            log('--chapters: only the chapter render, no joining')
            return
    miss = [rel(v) for v in vids if not v.exists()]
    if miss:
        raise PipelineError('no chapter videos: ' + ', '.join(miss))
    name = f'{ed.parent.name}_{ed.name}'
    out = Path(a.out).resolve() if a.out else ed / f'{name}.mp4'
    tmp = out if a.out else out.with_name(f'{name}.tmp.mp4')
    lv = ed / '_video.txt'
    la = ed / '_audio.txt'
    lv.write_text(''.join(f"file '{v.as_posix()}'\n" for v in vids), encoding='utf-8')
    la.write_text(''.join(f"file '{(p.parent / 'audio' / 'mix.wav').as_posix()}'\n" for p in chs), encoding='utf-8')
    ffmpeg('-f', 'concat', '-safe', '0', '-i', lv, '-f', 'concat', '-safe', '0', '-i', la, '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy',
           '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', tmp)
    if tmp != out:
        os.replace(tmp, out)
    # episode subtitles — shifted by the chapters
    off, cues = 0.0, []
    for p in chs:
        tl = load_json(p.parent / 'timeline.json')
        cues += [{**c, 'from': c['from'] + off, 'to': c['to'] + off} for c in tl['cues']]
        off += tl['duration']
    audio.srt({'cues': cues}, ed / f'{name}.srt')
    log(f'episode: {len(chs)} chapters, {off:.1f} s, {"3840×2160" if a.k4 else "1920×1080"} → {rel(out)}')


def frames(v: Path) -> int:
    r = subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-count_packets', '-show_entries', 'stream=nb_read_packets',
                        '-of', 'csv=p=0', str(v)], capture_output=True, text=True)
    return int(r.stdout.strip() or 0)


def main():
    if len(sys.argv) > 1 and sys.argv[1] == 'episode':
        ap = argparse.ArgumentParser()
        ap.add_argument('cmd')
        ap.add_argument('dir')
        ap.add_argument('--4k', dest='k4', action='store_true', help='a 3840×2160 master: the chapters anew with scale 2')
        ap.add_argument('--chapters', help='with --4k: only the render of these chapters: 01,02 (no joining)')
        ap.add_argument('--batch', type=int, default=5400, help='--4k: frames per place in the CPU queue (default — 3 min of video)')
        ap.add_argument('--concurrency', type=int, default=4)
        ap.add_argument('--force-render', action='store_true')
        ap.add_argument('--out', help='the master file instead of <episode>_<language>.mp4 (written right into it)')
        return episode(ap.parse_args())
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('script')
    ap.add_argument('--lang', help='speech language (default: channel.json → language)')
    ap.add_argument('--steps', default='all')
    ap.add_argument('--go', action='store_true', help='voice new lines (paid)')
    ap.add_argument('--estimate', action='store_true', help='no TTS: estimated durations, silent speech')
    ap.add_argument('--until', type=float, help='only the first N seconds of the chapter')
    ap.add_argument('--scenes', help='only these scenes: 01,02')
    ap.add_argument('--model', help='TTS model instead of voices.json (eleven_v4)')
    ap.add_argument('--concurrency', type=int, default=4, help='render threads (default 4: other work may share the CPU)')
    ap.add_argument('--style', help='drawing style of the figures instead of channel.json → style (a folder of lib/styles)')
    ap.add_argument('--no-stt', action='store_true')
    ap.add_argument('--force-render', action='store_true')
    ap.add_argument('--work', help='work folder instead of episodes/…')
    ap.add_argument('--no-guard', action='store_true', help='without the accepted chapters guard (guard step)')
    ap.add_argument('--no-precheck', action='store_true', help='without the staging check before render (precheck step)')
    ap.add_argument('--no-hands', action='store_true', help='precheck without arm poses (tools/hands_check.mjs)')
    a = ap.parse_args()
    chapter(a)


if __name__ == '__main__':
    try:
        main()
    except PipelineError as e:
        sys.exit(f'ERROR: {e}')
