"""A copy of the project code in %TEMP% for rendering: on some machines Remotion renders ~7 times slower from the project folder
(antivirus file scanning; docs/STACK.md, "Render").

python tools/mirror.py            — sync and print the path of the copy
Only code and fonts are copied (lib, remotion, tools, channels without episodes/, public). node_modules — a link (a junction on Windows,
a symlink elsewhere).
A repeated run copies only what changed and removes the rest.
SKINK_MIRROR=<folder> — an own copy; SKINK_MIRROR_FROZEN=1 — do not update it (a code snapshot, a mutation only in the copy): the pipeline
and the checks take the frame code from the snapshot as is.
The default copy is <temp>/<project folder name>-mirror: an episode worktree (tools/episode_ws.py, docs/PARALLEL.md) gets its own copy, so
two sessions do not write into one. An update of the copy runs under the lock <copy>.lock: two processes of one copy do not copy and delete
files in a race.
"""
import os
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def default_dst(root: Path) -> Path:
    """The default code copy of a checkout (without SKINK_MIRROR): <temp>/<checkout folder name>-mirror."""
    return Path(os.environ.get('TEMP', '/tmp')) / f'{Path(root).name}-mirror'


DST = Path(os.environ.get('SKINK_MIRROR') or default_dst(ROOT))
DIRS = ['lib', 'remotion', 'channels', 'public', 'tools']
EXT = {'.ts', '.tsx', '.js', '.mjs', '.json', '.css', '.ttf', '.otf', '.woff', '.woff2'}
SKIP = {'episodes', 'node_modules', '__pycache__'}


def wanted():
    files = [ROOT / 'package.json']
    for d in DIRS:
        for dp, dn, fn in os.walk(ROOT / d):
            dn[:] = [x for x in dn if x not in SKIP]
            files += [Path(dp) / f for f in fn if Path(f).suffix.lower() in EXT]
    return files


class _Lock:
    """A file lock between processes: msvcrt.locking on Windows, fcntl.flock elsewhere; released when the process dies."""

    def __init__(self, path: Path):
        self.path = path

    def __enter__(self):
        self.f = open(self.path, 'a+b')
        if os.name == 'nt':
            import msvcrt
            import time
            while True:
                try:
                    self.f.seek(0)
                    msvcrt.locking(self.f.fileno(), msvcrt.LK_LOCK, 1)  # waits about 10 s and raises — then again
                    break
                except OSError:
                    time.sleep(0.2)
        else:
            import fcntl
            fcntl.flock(self.f, fcntl.LOCK_EX)
        return self

    def __exit__(self, *exc):
        try:
            if os.name == 'nt':
                import msvcrt
                self.f.seek(0)
                msvcrt.locking(self.f.fileno(), msvcrt.LK_UNLCK, 1)
        finally:
            self.f.close()


def sync() -> Path:
    if os.environ.get('SKINK_MIRROR_FROZEN') and DST.exists():
        # code snapshot: the copy is not updated (checking the code before someone else's edits, a mutation in the
        # copy) — SKINK_MIRROR=<snapshot> SKINK_MIRROR_FROZEN=1
        print(f'mirror: {DST} (frozen, not synced)', file=sys.stderr)
        return DST
    DST.parent.mkdir(parents=True, exist_ok=True)
    with _Lock(DST.parent / f'{DST.name}.lock'):
        return _sync()


def _sync() -> Path:
    DST.mkdir(parents=True, exist_ok=True)
    keep = set()
    n = 0
    for src in wanted():
        rel = src.relative_to(ROOT)
        dst = DST / rel
        keep.add(dst)
        st = src.stat()
        if dst.exists():
            ds = dst.stat()
            if ds.st_size == st.st_size and int(ds.st_mtime) == int(st.st_mtime):
                continue
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dst)
        n += 1
    gone = 0
    for d in DIRS:
        base = DST / d
        if not base.exists():
            continue
        for dp, _, fn in os.walk(base):
            for f in fn:
                p = Path(dp) / f
                if p not in keep:
                    p.unlink()
                    gone += 1
    nm = DST / 'node_modules'
    if not nm.exists():
        # in an episode worktree node_modules is itself a link to the main checkout: the copy links to the real folder
        target = os.path.realpath(ROOT / 'node_modules')
        if os.name == 'nt':
            subprocess.run(['cmd', '/c', 'mklink', '/J', str(nm), target], check=True, capture_output=True)
        else:
            nm.symlink_to(target, target_is_directory=True)
    print(f'mirror: {DST} (copied {n}, removed {gone})', file=sys.stderr)
    return DST


if __name__ == '__main__':
    print(sync())
