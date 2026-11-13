"""A queue of the heavy CPU steps — one per machine, shared by every session and every episode worktree (docs/PARALLEL.md).

Rendering runs on the CPU only: two renders of two sessions at once share the cores and both take about twice as long, and stills of the
checks next to a render slow it down. A heavy step takes a place in the queue and waits for its turn; the wait is written to the run log.

Capacity — 4 units: render — 3, precheck — 2 (the frame journal in 2 threads and the arm poses), stills — 1 (a guard chunk, frame sheets).
Next to a render only one chunk of stills runs; a second render and a precheck wait. A measurement on an 8-core / 16-thread CPU: a scene
of 1101 frames renders in 21 s alone and in 23 s next to a guard chunk of 120 frames; two renders at once take 1.6 times longer each. The
order is strictly by arrival: a light step does not overtake a waiting render. A place is a ticket file in the queue folder held open by
its process: if the process dies, the file is free and the next waiting process removes the ticket (Windows: a file opened by another
process cannot be deleted; elsewhere — flock). A nested request of the same process (precheck → frame journal) takes no place.

  SKINK_CPU_QUEUE=<folder>  — an own queue (default %LOCALAPPDATA%/skink-cpu-queue, ~/.cache/skink-cpu-queue elsewhere); off — no queue
  SKINK_CPU_UNITS=<N>       — the capacity (or <queue>/config.json → {"units": N})

python tools/cpu_queue.py                                                   — who holds a place and who waits
python tools/cpu_queue.py run [--kind stills] [--label …] -- <command …>    — a command through the queue (node tools/stills.mjs …)
"""
import contextlib
import json
import os
import subprocess
import sys
import time
from pathlib import Path

WEIGHT = {'render': 3, 'precheck': 2, 'stills': 1}
DEFAULT_UNITS = 4
POLL = 2.0  # s between checks of the queue
REPORT = 300  # s between "still waiting" lines
_held = 0  # places of this process (a nested request takes none)


def qdir() -> Path | None:
    v = os.environ.get('SKINK_CPU_QUEUE')
    if v == 'off':
        return None
    return Path(v) if v else Path(os.environ.get('LOCALAPPDATA') or Path.home() / '.cache') / 'skink-cpu-queue'


def units(q: Path) -> int:
    if os.environ.get('SKINK_CPU_UNITS'):
        try:
            return max(1, int(os.environ['SKINK_CPU_UNITS']))
        except ValueError:
            print(f'CPU queue: SKINK_CPU_UNITS={os.environ["SKINK_CPU_UNITS"]!r} is not a number — {DEFAULT_UNITS} units', file=sys.stderr)
            return DEFAULT_UNITS
    try:
        return max(1, int(json.loads((q / 'config.json').read_text(encoding='utf-8')).get('units', DEFAULT_UNITS)))
    except (OSError, ValueError):
        return DEFAULT_UNITS


def _ticket(me: Path, info: dict):
    """Creates the ticket me and returns it open; it stays open for the whole step. Windows: a file opened by its owner cannot be deleted.
    Elsewhere the ticket is flock-ed, and it appears under its name only locked: it is written under a temporary name, locked, then renamed
    (the lock goes with the file), so a waiting process never takes a fresh unlocked ticket for a dead one."""
    data = json.dumps(info, ensure_ascii=False)
    if os.name == 'nt':
        f = open(me, 'x', encoding='utf-8')
        f.write(data)
        f.flush()
        return f
    import fcntl
    tmp = me.with_name(me.name + '.new')
    f = open(tmp, 'x', encoding='utf-8')
    fcntl.flock(f, fcntl.LOCK_EX | fcntl.LOCK_NB)
    f.write(data)
    f.flush()
    os.rename(tmp, me)
    return f


def _dead(p: Path) -> bool:
    """A ticket without a live owner — remove it. Windows: a file opened by its owner cannot be deleted (PermissionError)."""
    if os.name == 'nt':
        try:
            p.unlink()
            return True
        except PermissionError:
            return False
        except FileNotFoundError:
            return True
    import fcntl
    try:
        with open(p, 'rb') as f:
            fcntl.flock(f, fcntl.LOCK_EX | fcntl.LOCK_NB)
        p.unlink(missing_ok=True)
        return True
    except BlockingIOError:
        return False
    except FileNotFoundError:
        return True


def _info(p: Path) -> dict:
    try:
        return json.loads(p.read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return {}


def tickets(q: Path, me: Path | None = None) -> list:
    """Live tickets in the order of arrival: [(path, weight)]; dead ones are removed."""
    out = []
    for p in sorted(q.glob('*.tk')):
        if p != me and _dead(p):
            continue
        try:
            w = int(p.stem.rsplit('_', 1)[1])
        except (IndexError, ValueError):
            w = DEFAULT_UNITS
        out.append((p, w))
    return out


def _who(p: Path) -> str:
    i = _info(p)
    t = time.strftime('%H:%M', time.localtime(i['t'])) if i.get('t') else '?'
    return f'{i.get("label", p.stem)} (pid {i.get("pid", "?")}, since {t})'


@contextlib.contextmanager
def slot(kind: str, label: str = '', log=print):
    """A place in the CPU queue for the time of a step: with slot('render', 'ch02 s01e03', log): … — waits for its turn, the wait goes to log."""
    global _held
    q = qdir()
    if q is None or _held:
        _held += 1
        try:
            yield
        finally:
            _held -= 1
        return
    q.mkdir(parents=True, exist_ok=True)
    cap = units(q)
    w = min(WEIGHT.get(kind, 1), cap)
    me = q / f'{time.time_ns():020d}_{os.getpid()}_{w}.tk'
    info = {'kind': kind, 'label': label or kind, 'pid': os.getpid(), 't': time.time(), 'cwd': os.getcwd()}
    f = _ticket(me, info)
    try:
        t0 = time.time()
        said = 0.0
        while True:
            live = tickets(q, me)
            names = [p for p, _ in live]
            if me not in names:  # the ticket is gone (removed by hand): the same name again — the same place in the order
                f.close()
                f = _ticket(me, info)
                continue
            ahead = live[:names.index(me)]
            used = sum(pw for _, pw in ahead)
            if used + w <= cap:
                break
            now = time.time()
            if not said or now - said >= REPORT:
                log(f'CPU queue: {kind} {label} waits ({used + w} of {cap} units), ahead {len(ahead)}: ' + '; '.join(_who(x) for x, _ in ahead[:4])
                    + (f' — waiting for {int(now - t0) // 60} min' if said else ''))
                said = now
            time.sleep(POLL)
        if said:
            log(f'CPU queue: {kind} {label} — a place after {int(time.time() - t0) // 60} min {int(time.time() - t0) % 60} s of waiting')
        _held += 1
        try:
            yield
        finally:
            _held -= 1
    finally:
        f.close()
        try:
            me.unlink()
        except OSError:
            pass  # another process is reading the file — the next waiting one removes it


def main():
    a = sys.argv[1:]
    q = qdir()
    if not a:
        if q is None or not q.exists():
            print('CPU queue: empty' if q else 'CPU queue: off (SKINK_CPU_QUEUE=off)')
            return 0
        cap = units(q)
        live = tickets(q)
        print(f'CPU queue {q}: capacity {cap}')
        used = 0
        for p, w in live:
            # strictly by arrival: a ticket runs while the weights of all the tickets before it and its own fit into the capacity
            print(f'  {"runs " if used + w <= cap else "waits"} {w} units — {_who(p)}')
            used += w
        if not live:
            print('  empty')
        return 0
    if a[0] == 'run' and '--' in a:
        opts, cmd = a[1:a.index('--')], a[a.index('--') + 1:]
        kind = opts[opts.index('--kind') + 1] if '--kind' in opts else 'stills'
        label = opts[opts.index('--label') + 1] if '--label' in opts else ' '.join(cmd)[:60]
        with slot(kind, label, log=lambda s: print(s, file=sys.stderr, flush=True)):
            return subprocess.run(cmd).returncode
    print(__doc__)
    return 2


if __name__ == '__main__':
    sys.exit(main())
