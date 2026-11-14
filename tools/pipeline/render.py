"""Step 4: render of the chapter video by timeline.json — Remotion (composition <channel>-chapter), on the CPU, scene by scene.

The code is copied to the temp folder (tools/mirror.py) and rendered from there (docs/STACK.md, "Render").
A scene is a separate mp4 (render/sNN.mp4); a cache by the hash of the code, the chapter header (channel, drawing style, fps, frame size)
and the scene data: only changed scenes are re-rendered.
Scenes are joined by ffmpeg concat without re-encoding → render/video.mp4 (no sound).
The render goes through the CPU queue of the machine (tools/cpu_queue.py, a render place): a render of another session — wait, the wait is
written to the run log.
Encoding — h264 CRF 18, yuv420p, bt709. The working render of a chapter is 1920×1080 (scale 1); a 4K episode master (run.py episode --4k)
renders the same compositions with scale 2 (3840×2160: the vector frame is drawn anew, not an upscale) into the episode folder
(docs/PIPELINE.md "Episode master"); batch — frames per place in the CPU queue: a long master render gives the queue away between chunks.
"""
import subprocess
from pathlib import Path

from tools.pipeline.common import ROOT, PipelineError, channel_of, ffmpeg, log, node_exe, save_json, sha
from tools import cpu_queue, mirror

CRF = 18  # h264: working chapter renders and the episode master

def code_hash() -> str:
    return sha(*[p.read_bytes().decode('utf-8', 'replace') for p in sorted(mirror.wanted()) if p.suffix in ('.ts', '.tsx', '.mjs', '.json')])


def run(tl: dict, tl_path: Path, wd: Path, composition=None, concurrency=4, force=False, scale=1, rd=None, batch=None):
    composition = composition or f'{channel_of(tl, wd)}-chapter'  # remotion/channels.ts registers <channel>-chapter for every channel
    rd = Path(rd or wd / 'render').resolve()
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
        h = sha(ch, head, shots, cues, composition, *([scale] if scale != 1 else []))[:16]  # scale 1 keeps the old key: chapter caches stay valid
        out = rd / f's{sid}.mp4'
        hf = rd / f's{sid}.hash'
        parts.append(out)
        if not force and out.exists() and hf.exists() and hf.read_text() == h:
            continue
        jobs.append({'name': f's{sid}', 'from': a, 'to': b, 'out': str(out), 'hash': h, 'hf': str(hf)})
    # chunks of batch frames — each with its own place in the CPU queue (renders of other sessions pass between chunks)
    chunks = []
    for j in jobs:
        if not chunks or (batch and sum(x['to'] - x['from'] + 1 for x in chunks[-1]) + j['to'] - j['from'] + 1 > batch):
            chunks.append([])
        chunks[-1].append(j)
    size = f'{tl.get("width", 1920) * scale}×{tl.get("height", 1080) * scale}' if scale != 1 else ''
    if jobs:
        log(f'render{" " + size if size else ""}: scenes {len(jobs)} of {len(groups)}, frames {sum(j["to"] - j["from"] + 1 for j in jobs)}'
            + (f', chunks {len(chunks)}' if len(chunks) > 1 else ''))
    for k, chunk in enumerate(chunks):
        m = mirror.sync()
        spec = {'composition': composition, 'timeline': str(tl_path.resolve()), 'concurrency': concurrency, 'crf': CRF, 'scale': scale,
                'jobs': [{x: j[x] for x in ('name', 'from', 'to', 'out')} for j in chunk]}
        js = rd / ('jobs.json' if len(chunks) == 1 else f'jobs_{k + 1:02d}.json')
        save_json(js, spec)
        if len(chunks) > 1:
            log(f'  chunk {k + 1}/{len(chunks)}: {chunk[0]["name"]}…{chunk[-1]["name"]}, frames {sum(j["to"] - j["from"] + 1 for j in chunk)}, from {m}')
        else:
            log(f'  from {m}')
        lg = rd / ('render.log' if len(chunks) == 1 else f'render_{k + 1:02d}.log')
        with cpu_queue.slot('render', f'{ROOT.name} {wd.name}{" " + size if size else ""}', log), open(lg, 'w', encoding='utf-8') as lf:
            r = subprocess.run([node_exe(), str(Path(m) / 'tools' / 'render.mjs'), str(js)], cwd=m, stdout=lf,
                               stderr=subprocess.STDOUT, text=True, encoding='utf-8', errors='replace')
        tail = lg.read_text(encoding='utf-8', errors='replace').strip().splitlines()[-6:]
        for line in tail:
            log('  ' + line[:200])
        if r.returncode:
            raise PipelineError(f'render failed, log — {lg}')
        for j in chunk:
            Path(j['hf']).write_text(j['hash'])
    if not jobs:
        log('render: all scenes are cached')
    lst = rd / 'concat.txt'
    lst.write_text(''.join(f"file '{p.as_posix()}'\n" for p in parts), encoding='utf-8')
    ffmpeg('-f', 'concat', '-safe', '0', '-i', lst, '-c', 'copy', rd / 'video.mp4')
    return rd / 'video.mp4'


if __name__ == '__main__':
    print(code_hash()[:12], ROOT)
