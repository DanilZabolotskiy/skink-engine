"""Shared parts of the pipeline steps: paths, channel config, ffmpeg, JSON. The pipeline is described in docs/PIPELINE.md."""
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


class PipelineError(Exception):
    """Input error (script, config) — printed without a traceback."""


def load_json(p):
    return json.loads(Path(p).read_text(encoding='utf-8'))


def save_json(p, data):
    p = Path(p)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding='utf-8', newline='\n')


def sha(*parts) -> str:
    h = hashlib.sha1()
    for x in parts:
        h.update((x if isinstance(x, str) else json.dumps(x, sort_keys=True, ensure_ascii=False)).encode('utf-8'))
        h.update(b'\0')
    return h.hexdigest()


def channel_dir(script: Path) -> Path:
    parts = script.resolve().parts
    if 'channels' not in parts:
        raise PipelineError(f'the script is not inside channels/<channel>/: {script}')
    i = parts.index('channels')
    return Path(*parts[:i + 2])


def channel_of(tl: dict, path) -> str:
    """Channel id of a timeline: timeline.json → channel, or the channels/<channel>/ folder the work folder is in."""
    return tl.get('channel') or channel_dir(Path(path)).name


def channel_of_work(wd: Path, tl: dict | None = None) -> Path:
    """Channel folder of a chapter work folder: channels/<timeline.json → channel>, so a work folder outside channels/ (run.py --work)
    works too; without a channel in the timeline — the channels/<channel>/ folder the work folder is in."""
    tl = tl if tl is not None else load_json(Path(wd) / 'timeline.json')
    if tl.get('channel') and (ROOT / 'channels' / tl['channel'] / 'pipeline' / 'channel.json').exists():
        return ROOT / 'channels' / tl['channel']
    return channel_dir(Path(wd))


def chapter_video(wd: Path) -> Path:
    """The assembled video of a chapter work folder (run.py): <folder>.mp4 for a chNN folder, otherwise chapter.mp4."""
    wd = Path(wd)
    return wd / (f'{wd.name}.mp4' if wd.name.startswith('ch') else 'chapter.mp4')


def style_ids() -> list:
    """Drawing styles of the engine: the folders lib/styles/<id>/ with an index.ts or index.tsx (registered in lib/styles/registered.ts)."""
    return sorted({p.parent.name for p in (ROOT / 'lib' / 'styles').glob('*/index.ts*')})


class Channel:
    """Channel config: channels/<channel>/pipeline/*.json."""

    def __init__(self, cdir: Path):
        self.dir = cdir
        self.id = cdir.name
        pdir = cdir / 'pipeline'
        if not (pdir / 'channel.json').exists():
            raise PipelineError(f'no {pdir / "channel.json"} — the channel config for the pipeline')
        self.cfg = load_json(pdir / 'channel.json')
        # "\b" in JSON is the backspace character, not a word boundary: such a regex silently never matches (roles and verbs are not
        # found). In channel.json a word boundary is written "\\b".
        bad = []

        def scan(o, path):
            if isinstance(o, dict):
                for k, v in o.items():
                    scan(v, f'{path}/{k}')
            elif isinstance(o, list):
                for i, v in enumerate(o):
                    scan(v, f'{path}/{i}')
            elif isinstance(o, str) and '\x08' in o:
                bad.append(path)
        scan(self.cfg, '')
        if bad:
            raise PipelineError(f'{pdir / "channel.json"}: strings contain the backspace character (\\b in JSON) — a word boundary is written "\\\\b": {", ".join(bad[:8])}')
        self.voices = load_json(pdir / 'voices.json')
        self.music = load_json(pdir / 'music.json')
        self.sfx = load_json(pdir / 'sfx.json')
        self.colors = load_json(pdir / 'colors.json').get('reference', {}) if (pdir / 'colors.json').exists() else {}
        self.lang = self.cfg.get('language', 'en')

    def speaker(self, name: str):
        """Speaker → (canonical name, voice entry, whether it is a copy) or None. <NAME>_VOICE (voices.json → voice_suffix) — a copy of
        the voice of <NAME> processed by an ffmpeg effect."""
        sp = self.voices['speakers']
        vs = self.voices.get('voice_suffix', {})
        suf = vs.get('suffix')
        mimic = bool(suf and name.endswith(suf) and name not in sp)
        if mimic:
            name = name[:-len(suf)]
        name = self.voices.get('aliases', {}).get(name, name)
        return (name, sp[name], mimic) if name in sp else None

    def mimic_effect(self, text: str) -> str | None:
        """Processing of a voice copy by the words of NOTE / tags (voices.json → voice_suffix.effects); none matched — voice_suffix.default
        (none set — no processing)."""
        vs = self.voices.get('voice_suffix', {})
        low = (text or '').lower()
        best, score = vs.get('default'), 0
        for k, e in vs.get('effects', {}).items():
            for w in e['keys']:
                if w in low and len(w) > score:
                    best, score = k, len(w)
        return best


def work_dir(script: Path, lang: str, ch: Channel) -> Path:
    """Chapter work folder (not in git): episodes/<s01e01>/<lang>/<ch01>/; drafts — episodes/_test/<folder>/<lang>/."""
    s = script.resolve().as_posix()
    m = re.search(r'/seasons/(s\d+)/(ep\d+)/(ch\d+)/', s)
    if m:
        return ch.dir / 'episodes' / f'{m.group(1)}e{m.group(2)[2:]}' / lang / m.group(3)
    return ch.dir / 'episodes' / '_test' / script.parent.name / lang


def ffmpeg(*args, quiet=True):
    cmd = ['ffmpeg', '-hide_banner', '-y'] + (['-v', 'error'] if quiet else []) + [str(a) for a in args]
    r = subprocess.run(cmd, capture_output=True, text=True, encoding='utf-8', errors='replace')
    if r.returncode:
        raise RuntimeError('ffmpeg: ' + r.stderr[-1500:])
    return r


def probe_duration(p) -> float:
    r = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', str(p)],
                       capture_output=True, text=True)
    return float(r.stdout.strip())


def node_exe() -> str:
    for c in (shutil.which('node'), r'C:\Program Files\nodejs\node.exe', '/usr/local/bin/node', '/opt/homebrew/bin/node'):
        if c and Path(c).exists():
            return c
    raise PipelineError('node not found (Node.js 24+)')


def log(*a):
    print(*a, flush=True)


def rel(p) -> str:
    try:
        return Path(p).resolve().relative_to(ROOT).as_posix()
    except ValueError:
        return str(p)


def has_hangul(s: str) -> bool:
    return bool(re.search(r'[\uac00-\ud7a3]', s))


os.environ.setdefault('PYTHONIOENCODING', 'utf-8')
