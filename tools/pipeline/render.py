"""Step 4: render of the chapter video by timeline.json — Remotion (composition <channel>-chapter), on the CPU, scene by scene.

The code is copied to the temp folder (tools/mirror.py) and rendered from there (docs/STACK.md, "Render").
A scene is a separate mp4 (render/sNN.mp4); a cache by the hash of the code, the chapter header (channel, drawing style, fps, frame size)
and the scene data: only changed scenes are re-rendered.
Scenes are joined by ffmpeg concat without re-encoding → render/video.mp4 (no sound).
The render goes through the CPU queue of the machine (tools/cpu_queue.py, a render place): a render of another session — wait, the wait is
written to the run log.
"""
import subprocess
from pathlib import Path

from tools.pipeline.common import ROOT, PipelineError, channel_of, ffmpeg, log, node_exe, save_json, sha
from tools import cpu_queue, mirror


def code_hash() -> str:
    return sha(*[p.read_bytes().decode('utf-8', 'replace') for p in sorted(mirror.wanted()) if p.suffix in ('.ts', '.tsx', '.mjs', '.json')])


def run(tl: dict, tl_path: Path, wd: Path, composition=None, concurrency=4, force=False):
    composition = composition or f'{channel_of(tl, wd)}-chapter'  # remotion/channels.ts registers <channel>-chapter for every channel
    rd = (wd / 'render').resolve()
    rd.mkdir(parents=True, exist_ok=True)
    ch = code_hash()
    # the timeline fields the composition reads besides the shots and cues of a scene: another drawing style is another video
    head = {k: tl.get(k) for k in ('channel', 'style', 'fps', 'width', 'height')}
    groups = {}
    for s in tl['shots']:
        groups.setdefault(s['scene'], []).append(s)
    jobs, parts = [], []
    for sid, shots in groups.items():
        a, b = shots[0]['from'], shots[-1]['to'] - 1
        cues = [c for c in tl['cues'] if c['to'] >= a / tl['fps'] and c['from'] <= (b + 1) / tl['fps']]
        h = sha(ch, head, shots, cues, composition)[:16]
        out = rd / f's{sid}.mp4'
        hf = rd / f's{sid}.hash'
        parts.append(out)
        if not force and out.exists() and hf.exists() and hf.read_text() == h:
            continue
        jobs.append({'name': f's{sid}', 'from': a, 'to': b, 'out': str(out), 'hash': h, 'hf': str(hf)})
    if jobs:
        m = mirror.sync()
        spec = {'composition': composition, 'timeline': str(tl_path.resolve()), 'concurrency': concurrency,
                'jobs': [{k: j[k] for k in ('name', 'from', 'to', 'out')} for j in jobs]}
        save_json(rd / 'jobs.json', spec)
        log(f'render: scenes {len(jobs)} of {len(groups)}, frames {sum(j["to"] - j["from"] + 1 for j in jobs)}, from {m}')
        with cpu_queue.slot('render', f'{ROOT.name} {wd.name}', log), open(rd / 'render.log', 'w', encoding='utf-8') as lf:
            r = subprocess.run([node_exe(), str(Path(m) / 'tools' / 'render.mjs'), str(rd / 'jobs.json')], cwd=m, stdout=lf,
                               stderr=subprocess.STDOUT, text=True, encoding='utf-8', errors='replace')
        tail = (rd / 'render.log').read_text(encoding='utf-8', errors='replace').strip().splitlines()[-6:]
        for line in tail:
            log('  ' + line[:200])
        if r.returncode:
            raise PipelineError(f'render failed, log — {rd / "render.log"}')
        for j in jobs:
            Path(j['hf']).write_text(j['hash'])
    else:
        log('render: all scenes are cached')
    lst = rd / 'concat.txt'
    lst.write_text(''.join(f"file '{p.as_posix()}'\n" for p in parts), encoding='utf-8')
    ffmpeg('-f', 'concat', '-safe', '0', '-i', lst, '-c', 'copy', rd / 'video.mp4')
    return rd / 'video.mp4'


if __name__ == '__main__':
    print(code_hash()[:12], ROOT)
