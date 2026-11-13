"""Keys from the environment or the .env file in the project root (never print them)."""
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def env(key):
    if key in os.environ:
        return os.environ[key]
    p = ROOT / ".env"
    for line in (p.read_text().splitlines() if p.exists() else []):
        if "=" in line and not line.lstrip().startswith("#"):
            k, v = line.split("=", 1)
            if k.strip() == key and v.strip():
                return v.strip().strip('"').strip("'")
    raise KeyError(f"{key}: set it in the environment or in .env (see .env.example)")
