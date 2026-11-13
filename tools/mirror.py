"""A copy of the project code in %TEMP% for rendering: on some machines Remotion renders ~7 times slower from the project folder
(antivirus file scanning; docs/STACK.md, "Render").

python tools/mirror.py            — sync and print the path of the copy
Only code and fonts are copied (lib, remotion, tools, channels without episodes/, public). node_modules — a link (a junction on Windows,
a symlink elsewhere).
A repeated run copies only what changed and removes the rest.
SKINK_MIRROR=<folder> — an own copy; SKINK_MIRROR_FROZEN=1 — do not update it (a code snapshot, a mutation only in the copy): the pipeline
and the checks take the frame code from the snapshot as is.
"""
import os
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DST = Path(os.environ.get('SKINK_MIRROR', Path(os.environ.get('TEMP', '/tmp')) / 'skink-engine-mirror'))
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


def sync() -> Path:
    if os.environ.get('SKINK_MIRROR_FROZEN') and DST.exists():
        # code snapshot: the copy is not updated (checking the code before someone else's edits, a mutation in the
        # copy) — SKINK_MIRROR=<snapshot> SKINK_MIRROR_FROZEN=1
        print(f'mirror: {DST} (frozen, not synced)', file=sys.stderr)
        return DST
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
        if os.name == 'nt':
            subprocess.run(['cmd', '/c', 'mklink', '/J', str(nm), str(ROOT / 'node_modules')], check=True, capture_output=True)
        else:
            nm.symlink_to(ROOT / 'node_modules', target_is_directory=True)
    print(f'mirror: {DST} (copied {n}, removed {gone})', file=sys.stderr)
    return DST


if __name__ == '__main__':
    print(sync())
