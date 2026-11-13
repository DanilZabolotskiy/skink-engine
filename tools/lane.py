"""Lanes of edits and accepted chapters: which accepted chapters an edit touches, freezing, guard of the touched ones only (docs/PARALLEL.md).

python tools/lane.py check [--base main | --since REV | --staged]   — changed files: lane, which accepted chapters use them, frozen files
python tools/lane.py guard [--events] [--base main | --since REV | --staged] [--all] [--out DIR]
                                                                    — guard (tools/guard.py) of the touched accepted chapters and a rebuild
                                                                      of their timelines (retime); the result is a stamp for the commit
python tools/lane.py usage <file> …                                 — which accepted chapters use a file
python tools/lane.py retime                                         — parse + timeline of every accepted chapter by the current code = its
                                                                      timeline.json
python tools/lane.py hook                                           — pre-commit (tools/hooks/pre-commit): freezing, lanes, the guard stamp

What changed: by default — the working tree against HEAD (what goes into the commit); --base main — against the merge base with main (the
whole episode branch); --since REV — against REV (after git merge main: --since ORIG_HEAD); --staged — the index against HEAD.

Who uses what (the frames of an accepted chapter are drawn by the code from its frozen timeline.json):
- the core — the static imports of remotion/index.ts (lib/, the channel modules and what they import) and the render path (tools/render.mjs,
  stills.mjs, remotion.mjs, mirror.py, package.json, public/) — every accepted chapter;
- a kit channels/<channel>/chapter/kits/<file>.tsx (export KIT with an id) and its imports — the chapters with a shot of that kit;
- a role file channels/<channel>/chapter/roles/<file>.tsx (export ROLES) and its imports — the chapters with those roles in a shot;
- the config (pipeline/*.json, pipeline/parts/*.json, tools/pipeline/*.py, lib/staging/actions.json) does not change the frames of accepted
  chapters but changes their rebuild (retime): the base config — all of them, a part file with "episode" — the chapters of that episode.
Freezing: the script and the staging of an accepted chapter (seasons/<season>/<episode>/<chapter>/) and the files of an episode whose
chapters are all accepted (a part file with its "episode", chapter/roles/<episode>.tsx) do not change — an error (an edit of an accepted
chapter — only by the owner's decision: SKINK_UNFREEZE=1).
Lanes: a file used by accepted chapters and every shared file — the engine lane; the files of a chapter (channels/<channel>/seasons/,
chapter/kits/, chapter/roles/, pipeline/parts/ that no accepted chapter uses) — the chapter lane. A commit has one lane; an engine-lane
commit that touches the frames or the rebuild of accepted chapters needs a guard stamp of those chapters (lane.py guard, 0 differences).
SKINK_LANE=off — the hook lets everything through (only by the owner's decision).
"""
import argparse
import contextlib
import io
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from tools.pipeline.common import accepted_dirs, episode_of, load_json, save_json  # noqa: E402

RENDER_PATH = ['tools/render.mjs', 'tools/stills.mjs', 'tools/remotion.mjs', 'tools/mirror.py', 'package.json', 'package-lock.json']
CONFIG_ALL = ['lib/staging/actions.json']  # pipeline config inside lib: the rebuild of every chapter
TS = ('.ts', '.tsx')
NEUTRAL = re.compile(r'^channels/[^/]+/accepted(/[^/]+)?\.txt$')  # the lists of accepted chapters — in a commit of any lane
CHAPTER = re.compile(r'^channels/[^/]+/(seasons/|chapter/(kits|roles)/|pipeline/parts/)')  # files a chapter adds
# untracked files count only inside the project folders (leftovers of other tasks do not)
PROJECT = re.compile(r'^(lib/|tools/|remotion/|public/|channels/|docs/|\.claude/|[^/]+\.(md|json)$)')


def git(*a, check=True) -> str:
    r = subprocess.run(['git', *a], cwd=ROOT, capture_output=True, text=True, encoding='utf-8', errors='replace')
    if check and r.returncode:
        raise SystemExit(f'git {" ".join(a)}: {r.stderr.strip()[-500:]}')
    return r.stdout


def rel(p: Path) -> str:
    return p.resolve().relative_to(ROOT).as_posix()


def block(src: str, start: str) -> str:
    """The statement that begins with `start` up to the end of its top-level object (a line "};" or ";" at the line end)."""
    i = src.find(start)
    if i < 0:
        return ''
    j = src.find('\n};', i)
    k = src.find(';\n', i)
    ends = [x for x in (j + 3 if j >= 0 else -1, k + 1 if k >= 0 else -1) if x > 0]
    return src[i:min(ends) if ends else len(src)]


# ---------------------------------------------------------------- who uses what

class Usage:
    """Accepted chapters and the files their frames (code) and their rebuild (conf) depend on."""

    def __init__(self):
        self.imports = {}
        self._graph()
        self.core = self.closure(['remotion/index.ts']) | set(RENDER_PATH) | set(self._files('public'))
        self.kit_file = {}  # (channel, kit id) → file
        self.role_file = {}  # (channel, role) → file
        self.part_ep = {}  # part file → its episode (None — every episode)
        for ch in sorted(p for p in (ROOT / 'channels').iterdir() if p.is_dir()):
            for p in sorted((ch / 'chapter' / 'kits').glob('*.tsx')):
                for kid in re.findall(r"\bid: '([\w-]+)'", block(p.read_text(encoding='utf-8'), 'export const KIT')):
                    self.kit_file[(ch.name, kid)] = rel(p)
            for p in sorted((ch / 'chapter' / 'roles').glob('*.tsx')):
                for who in re.findall(r"^  '?([A-Za-z_]\w*)'?: ", block(p.read_text(encoding='utf-8'), 'export const ROLES'), re.M):
                    self.role_file[(ch.name, who)] = rel(p)
            for p in sorted((ch / 'pipeline' / 'parts').glob('*.json')):
                self.part_ep[rel(p)] = load_json(p).get('episode')
        self.chapters = []  # [{'label', 'wd', 'cdir', 'ep', 'own', 'code', 'conf'}]
        for cdir in sorted(p for p in (ROOT / 'channels').iterdir() if p.is_dir()):
            for wd in accepted_dirs(cdir):
                self.chapters.append(self._chapter(cdir, wd))

    @staticmethod
    def _files(d):
        base = ROOT / d
        return [rel(p) for p in base.rglob('*') if p.is_file()] if base.exists() else []

    def _graph(self):
        for r in [ROOT / 'lib', ROOT / 'remotion'] + sorted((ROOT / 'channels').glob('*/chapter')):
            for p in r.rglob('*'):
                if p.suffix not in TS or 'node_modules' in p.parts:
                    continue
                src = p.read_text(encoding='utf-8', errors='replace')
                deps = set()
                for spec in re.findall(r"(?:\bfrom|\bimport)\s*['\"](\.{1,2}/[^'\"]+)['\"]", src):
                    t = self._resolve(p.parent, spec)
                    if t:
                        deps.add(t)
                self.imports[rel(p)] = deps

    @staticmethod
    def _resolve(base: Path, spec: str):
        q = base / spec
        for c in [q, *[Path(str(q) + e) for e in ('.ts', '.tsx', '.js', '.mjs', '.json')], q / 'index.ts', q / 'index.tsx']:
            if c.is_file():
                return rel(c)
        return None

    def closure(self, start) -> set:
        seen, todo = set(), list(start)
        while todo:
            f = todo.pop()
            if f in seen:
                continue
            seen.add(f)
            todo += list(self.imports.get(f, ()))
        return seen

    def _chapter(self, cdir: Path, wd: Path) -> dict:
        tl = load_json(wd / 'timeline.json') if (wd / 'timeline.json').exists() else {'shots': []}
        ep = tl.get('episode') or episode_of(wd)
        m = re.search(r'/episodes/(s\d+)e(\d+)/[^/]+/(ch\d+)$', wd.as_posix())
        own = f'{rel(cdir)}/seasons/{m.group(1)}/ep{m.group(2)}/{m.group(3)}/' if m else None
        kits = {s['kit'] for s in tl['shots'] if s.get('kit')}
        roles = {c['who'] for s in tl['shots'] for c in s.get('cast', [])}
        starts = [self.kit_file[(cdir.name, k)] for k in kits if (cdir.name, k) in self.kit_file]
        starts += [self.role_file[(cdir.name, r)] for r in roles if (cdir.name, r) in self.role_file]
        pdir = f'{rel(cdir)}/pipeline'
        conf = {f'{pdir}/{x}' for x in ('channel.json', 'voices.json', 'sfx.json', 'music.json')} | set(CONFIG_ALL)
        conf |= {f for f, e in self.part_ep.items() if f.startswith(f'{pdir}/') and e in (None, ep)}
        return {'label': f'{cdir.name}/{ep or wd.parent.parent.name}/{wd.name}', 'wd': wd, 'cdir': cdir, 'ep': ep, 'own': own,
                'lang': tl.get('lang') or wd.parent.name, 'code': self.core | self.closure(starts), 'conf': conf}

    def users(self, path: str) -> tuple:
        """(chapters whose frames depend on the file, chapters whose rebuild depends on the file)."""
        if path.startswith('tools/pipeline/') and path.endswith('.py'):
            return [], [c['label'] for c in self.chapters]
        frames = [c['label'] for c in self.chapters if path in c['code']]
        conf = [c['label'] for c in self.chapters if path in c['conf'] or (c['own'] and path.startswith(c['own']))]
        return frames, conf

    def frozen(self, path: str) -> list:
        """Accepted chapters a file belongs to as a whole: the script folder of a chapter, the files of an episode whose chapters are all
        accepted (a part file with that "episode", chapter/roles/<episode>.tsx)."""
        own = [c['label'] for c in self.chapters if c['own'] and path.startswith(c['own'])]
        if own:
            return own
        m = re.match(r'^(channels/[^/]+)/(?:pipeline/parts/.+\.json|chapter/roles/(s\d+e\d+)\.tsx)$', path)
        ep = (m.group(2) or self.part_ep.get(path)) if m else None
        if not ep:
            return []
        e = re.match(r's(\d+)e(\d+)$', ep)
        chs = sorted(p.name for p in (ROOT / m.group(1) / 'seasons' / f's{e.group(1)}' / f'ep{e.group(2)}').glob('ch*') if p.is_dir())
        acc = [c['label'] for c in self.chapters if c['ep'] == ep and c['cdir'] == ROOT / m.group(1)]
        return acc if chs and len(acc) >= len(chs) else []


def lane_of(path: str, frames: list, conf: list) -> str:
    if NEUTRAL.match(path):
        return 'any'
    if frames or conf or not CHAPTER.match(path):
        return 'engine'
    return 'chapter'


# ---------------------------------------------------------------- what changed

def changed(a) -> list:
    """[(status A/M/D, path)] by the mode: --staged, --since REV, --base BRANCH (the merge base), otherwise the working tree against HEAD."""
    if a.staged:
        out = git('diff', '--cached', '--name-status', '-M')
        untracked = ''
    else:
        rev = a.since or (git('merge-base', 'HEAD', a.base).strip() if a.base else 'HEAD')
        out = git('diff', '--name-status', '-M', rev)
        untracked = git('ls-files', '--others', '--exclude-standard')
    res = []
    for ln in out.splitlines():
        p = ln.split('\t')
        if not p or not p[0]:
            continue
        if p[0][0] == 'R':
            res += [('D', p[1]), ('A', p[2])]
        else:
            res.append((p[0][0], p[-1]))
    res += [('A', x) for x in untracked.splitlines() if x and PROJECT.match(x)]
    return res


def analyse(a, u: Usage | None = None) -> dict:
    u = u or Usage()
    rows = []
    for st, path in changed(a):
        frames, conf = u.users(path)  # a new file too: the core or a kit of an accepted chapter may already import it
        if st == 'D' and (path.endswith(TS) or path.startswith('lib/')):
            frames = [c['label'] for c in u.chapters]  # deleted code: if it was imported, the frames change
        frz = u.frozen(path) if st != 'A' else []
        rows.append({'st': st, 'path': path, 'frames': frames, 'conf': conf, 'frozen': frz, 'lane': lane_of(path, frames, conf)})
    return {'rows': rows, 'usage': u}


def summary(res: dict) -> tuple:
    rows = res['rows']
    frames = sorted({c for r in rows for c in r['frames']})
    conf = sorted({c for r in rows for c in r['conf']})
    return frames, conf, [r for r in rows if r['frozen']]


def short(labels: list, total: int) -> str:
    return 'all accepted' if labels and len(labels) == total else (', '.join(labels) if labels else '—')


def cmd_check(a) -> int:
    res = analyse(a)
    n = len(res['usage'].chapters)
    rows = res['rows']
    if not rows:
        print('no changes')
        return 0
    print(f'{"st":2} {"lane":7} {"frames of accepted":28} {"rebuild":20} file')
    for r in rows:
        print(f'{r["st"]:2} {r["lane"]:7} {short(r["frames"], n)[:28]:28} {short(r["conf"], n)[:20]:20} {r["path"]}'
              + (f'   FROZEN ({", ".join(r["frozen"])})' if r['frozen'] else ''))
    frames, conf, frozen = summary(res)
    lanes = {r['lane'] for r in rows} - {'any'}
    print('\nguard: ' + (f'{short(frames, n)} → python tools/lane.py guard{" --staged" if a.staged else ""}' if frames else 'not needed'))
    print(f'rebuild (retime): {short(conf, n) if conf else "not needed"}')
    if len(lanes) > 1:
        print('lanes are mixed: commit the engine lane separately (git commit <engine paths>), then the chapter (docs/PARALLEL.md)')
    if frozen:
        print(f'FROZEN: {len(frozen)} files of accepted chapters — an edit only by the owner\'s decision (SKINK_UNFREEZE=1)')
        return 0 if os.environ.get('SKINK_UNFREEZE') else 1
    return 0


# ---------------------------------------------------------------- guard of the touched chapters and the stamp

def stamp_path() -> Path:
    return (ROOT / git('rev-parse', '--git-dir').strip()).resolve() / 'skink-lane-stamp.json'


def blob(path: str) -> str | None:
    return git('hash-object', path).strip() if (ROOT / path).is_file() else None


def retime(u: Usage, labels: list | None = None) -> list:
    """A rebuild of the accepted chapters by the current code: parse + speech from the cache (a copy of voice/, no API calls; an estimated
    chapter — estimated again) + timeline = their timeline.json. → [lines about the differences]."""
    from tools.pipeline import parse, timeline, voice
    from tools.pipeline.common import Channel, channel_dir
    bad = []
    for c in u.chapters:
        if labels is not None and c['label'] not in labels:
            continue
        sdir = ROOT / c['own'] if c['own'] else None
        if not sdir or not (sdir / 'script.md').exists():
            bad.append(f'{c["label"]}: no script {c["own"]}')
            continue
        ref = load_json(c['wd'] / 'timeline.json')
        script = parse.pick_script(sdir / 'script.md', c['lang'])
        chn = Channel(channel_dir(script), episode_of(script))
        if ref.get('style'):
            chn.cfg['style'] = ref['style']  # the chapter was built in this drawing style (run.py --style)
        with tempfile.TemporaryDirectory(prefix='skink-retime-') as td:
            od = Path(td)
            if (c['wd'] / 'voice').exists():
                shutil.copytree(c['wd'] / 'voice', od / 'voice')
            with contextlib.redirect_stdout(io.StringIO()):
                sc = parse.parse(script, chn, c['lang'])
                clips = voice.run(sc, od, chn, go=False, est=any(ln.get('estimate') for ln in ref['lines']))
                tl = timeline.build(sc, clips, chn, timeline.load_staging(script))
        tl = json.loads(json.dumps(tl, ensure_ascii=False))
        # the order of carried events of one shot may follow a set of roles (staging.carry_out), so it varies between runs: the events of a
        # shot are compared without their order
        for t in (tl, ref):
            for s in t['shots']:
                ev = (s.get('stage') or {}).get('events')
                if ev:
                    ev.sort(key=lambda e: json.dumps(e, sort_keys=True, ensure_ascii=False))
        if tl != ref:
            diff = [s['id'] for s, r in zip(tl['shots'], ref['shots']) if s != r]
            keys = [k for k in set(tl) | set(ref) if k != 'shots' and tl.get(k) != ref.get(k)]
            bad.append(f'{c["label"]}: another timeline — shots {", ".join(diff[:8]) or "—"}{"…" if len(diff) > 8 else ""}'
                       + (f'; fields {", ".join(sorted(keys))}' if keys else ''))
    return bad


def cmd_guard(a) -> int:
    res = analyse(a)
    u = res['usage']
    frames, conf, _ = summary(res)
    if a.all:
        frames = [c['label'] for c in u.chapters]
        conf = list(frames)
    files = {r['path']: blob(r['path']) for r in res['rows'] if (r['frames'] or r['conf'] or a.all) and r['st'] != 'D'}
    t0 = time.time()
    ok = True
    if frames:
        chs = [c for c in u.chapters if c['label'] in frames]
        out = (Path(a.out) if a.out else chs[0]['cdir'] / 'episodes' / '_lane' / ROOT.name / 'guard').resolve()
        print(f'guard: {len(chs)} accepted chapters ({", ".join(frames)}){" with event frames" if a.events else ""} → {out}', flush=True)
        r = subprocess.run([sys.executable, str(ROOT / 'tools' / 'guard.py'), *[str(c['wd']) for c in chs], '--out', str(out)]
                           + (['--events'] if a.events else []), cwd=ROOT)
        ok = r.returncode == 0
        print('guard: ' + ('0 differences' if ok else f'DIFFERENCES FOUND — pair sheets in {out}/<chapter>/pairs (docs/PIPELINE.md, '
                                                     '"Accepted chapters guard")'), flush=True)
    else:
        print('guard: the edit does not touch the frames of accepted chapters — not needed')
    rt = retime(u, conf) if conf else []
    if conf:
        print('rebuild of the accepted chapters (retime): ' + ('the same timeline' if not rt else 'DIFFERENT —\n  ' + '\n  '.join(rt)))
    ok = ok and not rt
    save_json(stamp_path(), {'time': time.strftime('%Y-%m-%d %H:%M'), 'sec': round(time.time() - t0), 'events': a.events, 'ok': ok,
                             'frames': frames, 'retime': conf, 'retime_bad': rt, 'files': files, 'head': git('rev-parse', 'HEAD').strip()})
    print(f'stamp: {stamp_path()} — an engine-lane commit of these files passes the hook' if ok else 'stamp: not 0 — an engine-lane commit will not pass')
    return 0 if ok else 1


def cmd_usage(a) -> int:
    u = Usage()
    for f in a.files:
        p = Path(f)
        path = rel(p) if p.exists() else f.replace('\\', '/')
        frames, conf = u.users(path)
        print(f'{path}: frames — {short(frames, len(u.chapters))}; rebuild — {short(conf, len(u.chapters))}; '
              f'frozen — {", ".join(u.frozen(path)) or "no"}; lane — {lane_of(path, frames, conf)}')
    return 0


def cmd_retime(a) -> int:
    bad = retime(Usage())
    print('rebuild of the accepted chapters: ' + ('every timeline is the same' if not bad else 'DIFFERENT —\n  ' + '\n  '.join(bad)))
    return 1 if bad else 0


def cmd_hook(a) -> int:
    """pre-commit: freezing, one lane per commit, a guard stamp for an engine-lane commit with accepted users."""
    if os.environ.get('SKINK_LANE') == 'off':
        return 0
    gd = stamp_path().parent
    if any((gd / x).exists() for x in ('MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD')):
        # a merge commit (sync: git merge main with a conflict) — the edits passed the hook in their branches; after it — lane.py guard --since
        return 0
    a.staged, a.since, a.base = True, None, None
    rows = analyse(a)['rows']
    errs = []
    frozen = [r for r in rows if r['frozen']]
    if frozen and not os.environ.get('SKINK_UNFREEZE'):
        errs.append('frozen (accepted chapters; an edit only by the owner\'s decision, SKINK_UNFREEZE=1): '
                    + ', '.join(f'{r["path"]} ({", ".join(r["frozen"])})' for r in frozen))
    if len({r['lane'] for r in rows} - {'any'}) > 1:
        eng = [r['path'] for r in rows if r['lane'] == 'engine']
        errs.append('lanes are mixed — commit the engine lane apart from the chapter (docs/PARALLEL.md). Engine lane: ' + ', '.join(eng[:12])
                    + ('…' if len(eng) > 12 else ''))
    need = [r for r in rows if (r['frames'] or r['conf']) and r['st'] != 'D']
    if need:
        st = load_json(stamp_path()) if stamp_path().exists() else {}
        staged = {}
        for ln in git('diff', '--cached', '--raw', '--no-abbrev', '-M').splitlines():
            p = ln.split('\t')
            meta = p[0].split()
            if len(meta) >= 4:
                staged[p[-1]] = meta[3]
        bad = [r['path'] for r in need if st.get('files', {}).get(r['path']) != staged.get(r['path'])]
        miss = sorted({c for r in need for c in r['frames']} - set(st.get('frames', [])))
        missc = sorted({c for r in need for c in r['conf']} - set(st.get('retime', [])))
        if bad or miss or missc or not st.get('ok'):
            errs.append('a guard of the touched accepted chapters is needed (python tools/lane.py guard --staged, 0 differences): '
                        + (f'files differ from the stamp — {", ".join(bad[:8])}; ' if bad else '')
                        + (f'chapters not checked — {", ".join(miss)}; ' if miss else '')
                        + (f'rebuild not checked — {", ".join(missc)}; ' if missc else '')
                        + ('the stamp is not 0' if st and not st.get('ok') else '' if st else 'no stamp'))
    if errs:
        print('lane (tools/lane.py hook):\n- ' + '\n- '.join(errs), file=sys.stderr)
        return 1
    return 0


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('cmd', choices=['check', 'guard', 'usage', 'retime', 'hook'])
    ap.add_argument('files', nargs='*')
    ap.add_argument('--base', help='a branch: against the merge base with it (main)')
    ap.add_argument('--since', help='against a revision (ORIG_HEAD after a merge)')
    ap.add_argument('--staged', action='store_true')
    ap.add_argument('--events', action='store_true', help='guard with the event frames too (before handing a chapter in)')
    ap.add_argument('--all', action='store_true', help='guard and rebuild of every accepted chapter')
    ap.add_argument('--out', help='folder of the guard reports')
    a = ap.parse_args()
    return {'check': cmd_check, 'guard': cmd_guard, 'usage': cmd_usage, 'retime': cmd_retime, 'hook': cmd_hook}[a.cmd](a)


if __name__ == '__main__':
    sys.exit(main())
