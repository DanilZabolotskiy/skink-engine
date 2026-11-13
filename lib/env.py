"""Keys from the environment or the .env file in the project root (never print them).

An episode worktree (tools/episode_ws.py, docs/PARALLEL.md) has no .env of its own and none is copied there: the keys are read from the
.env of the main checkout of the repository (git rev-parse --git-common-dir → its parent), in place.
"""
import functools
import os
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


@functools.lru_cache(maxsize=1)
def env_file() -> Path:
    """The key file: the .env of this checkout, otherwise the one of the main checkout (for an episode worktree). Found once per process."""
    own = ROOT / ".env"
    if own.exists():
        return own
    try:
        common = subprocess.run(["git", "rev-parse", "--git-common-dir"], cwd=ROOT, capture_output=True, text=True).stdout.strip()
    except OSError:
        common = ""
    if common:
        main = (ROOT / common).resolve().parent / ".env"
        if main.exists():
            return main
    return own


def env(key):
    if key in os.environ:
        return os.environ[key]
    p = env_file()
    for line in (p.read_text().splitlines() if p.exists() else []):
        if "=" in line and not line.lstrip().startswith("#"):
            k, v = line.split("=", 1)
            if k.strip() == key and v.strip():
                return v.strip().strip('"').strip("'")
    raise KeyError(f"{key}: set it in the environment or in .env (see .env.example)")
