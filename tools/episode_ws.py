"""The workplace of an episode: a git worktree next to the repository, its own branch, its own code copy and temp folders (docs/PARALLEL.md).

python tools/episode_ws.py new s01e03 [--base main] [--path DIR] [--channel ID]   — worktree ../<repo>-s01e03, branch ep/s01e03, links to
                                                                                     the shared folders, docs/API.md
python tools/episode_ws.py list                        — the workplaces: path, branch, behind / ahead of main, edits
python tools/episode_ws.py sync [--no-guard]           — (in a worktree) git merge main into the episode branch; then guard of what came
python tools/episode_ws.py land [--push] [--no-guard]  — (in a worktree) sync, then main fast-forwards to the episode branch
python tools/episode_ws.py remove s01e03 [--force]     — remove the worktree, its code copy and its branch (only merged into main; --force — any)

One Claude Code session = one episode = one worktree. The main checkout (branch main) is the merge point: nobody works in it and its working
tree stays clean; main moves only by a fast-forward from an episode worktree (land), conflicts are resolved in the episode worktree (sync).
The shared folders are not copied but linked to the main checkout (junctions on Windows, symlinks elsewhere; remove them only with rmdir,
never recursively — remove does that):
  node_modules                         — the npm dependencies (npm ci in the main checkout, not in git);
  channels/<channel>/episodes          — the chapter work folders of every episode: voice (a cache), videos and timelines of the accepted
                                         chapters (the guard reference);
  channels/<channel>/assets/sound, assets/music — the media libraries, if git ignores them.
new creates a missing shared folder in the main checkout first (a fresh clone has no episodes/ yet), so a worktree never gets its own copy;
remove refuses (without --force) when a worktree still has one of them as a real folder with content: it would go with the worktree.
Keys (.env) are not copied: lib/env.py reads the .env of the main checkout (git rev-parse --git-common-dir). The code copy for rendering is
<temp>/<worktree name>-mirror (tools/mirror.py); the CPU queue is one per machine (tools/cpu_queue.py).
SKINK_MAIN_BRANCH — the merge branch if it is not "main".
"""
import argparse
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from tools.mirror import default_dst  # noqa: E402

EP = re.compile(r'^s\d+e\d+$')
MAIN = os.environ.get('SKINK_MAIN_BRANCH', 'main')


def run(*a, cwd=None, check=True) -> str:
    r = subprocess.run(list(a), cwd=cwd or ROOT, capture_output=True, text=True, encoding='utf-8', errors='replace')
    if check and r.returncode:
        raise SystemExit(f'{" ".join(a)}:\n{(r.stderr or r.stdout).strip()[-1500:]}')
    return r.stdout


def git(*a, cwd=None, check=True) -> str:
    return run('git', *a, cwd=cwd, check=check)


def main_dir() -> Path:
    """The main checkout of the repository (for a worktree — the parent of the shared .git folder)."""
    return (ROOT / git('rev-parse', '--git-common-dir').strip()).resolve().parent


def untracked_shared(main: Path, p: str) -> bool:
    """git ignores the folder and tracks nothing in it: a folder of the machine, shared by every worktree."""
    ign = subprocess.run(['git', 'check-ignore', '-q', p], cwd=main, capture_output=True).returncode == 0
    return ign and not git('ls-files', p, cwd=main).strip()


def shared(main: Path, wt: Path | None = None) -> list:
    """The shared folders of a worktree: [(path from the root, what it is)] — node_modules, the episodes/ of every channel (of the main
    checkout and of the worktree) and the media libraries git ignores; whether they exist or not."""
    out = [('node_modules', 'npm dependencies')]
    chans = sorted({p.name for base in (main, wt) if base for p in (base / 'channels').glob('*') if p.is_dir()})
    for c in chans:
        for p, why in ((f'channels/{c}/episodes', 'chapter work folders: voice, guard references'),
                       (f'channels/{c}/assets/sound', 'the sound library'), (f'channels/{c}/assets/music', 'the music library')):
            if untracked_shared(main, p):
                out.append((p, why))
    return out


def is_link(p: Path) -> bool:
    """A junction or a symlink, not a folder with content: remove only with rmdir."""
    try:
        if os.path.islink(p) or (hasattr(os.path, 'isjunction') and os.path.isjunction(p)):
            return True
        return bool(getattr(os.lstat(p), 'st_file_attributes', 0) & 0x400)  # FILE_ATTRIBUTE_REPARSE_POINT
    except OSError:
        return False


def make_link(link: Path, target: Path):
    link.parent.mkdir(parents=True, exist_ok=True)
    if is_link(link):
        return
    if link.exists():
        raise SystemExit(f'{link} exists and is not a link — not touching it')
    if os.name == 'nt':
        run('cmd', '/c', 'mklink', '/J', str(link), str(target))
    else:
        link.symlink_to(target, target_is_directory=True)


def remove_link(link: Path):
    """Only the link, not its content: rmdir (a Windows junction) / unlink (a symlink). Never recursive."""
    if not is_link(link):
        return
    if os.name == 'nt':
        run('cmd', '/c', 'rmdir', str(link))
    else:
        link.unlink()
    if link.exists() or is_link(link):
        raise SystemExit(f'the link {link} was not removed — stopping (the content of the main checkout is not touched)')


def worktrees() -> list:
    """[{'path', 'branch', 'head'}] from git worktree list --porcelain."""
    out, cur = [], {}
    for ln in git('worktree', 'list', '--porcelain').splitlines() + ['']:
        if not ln:
            if cur:
                out.append(cur)
            cur = {}
        elif ln.startswith('worktree '):
            cur['path'] = Path(ln[9:])
        elif ln.startswith('branch '):
            cur['branch'] = ln[7:].replace('refs/heads/', '')
        elif ln.startswith('HEAD '):
            cur['head'] = ln[5:]
    return out


def ws_path(main: Path, ep: str) -> Path:
    return main.parent / f'{main.name}-{ep}'




def cmd_new(a):
    if not EP.match(a.ep):
        raise SystemExit(f'an episode is sNNeNN (s01e03), not "{a.ep}"')
    main = main_dir()
    wt = Path(a.path).resolve() if a.path else ws_path(main, a.ep)
    br = f'ep/{a.ep}'
    if wt.exists():
        raise SystemExit(f'{wt} already exists')
    if default_dst(wt) == default_dst(main):
        raise SystemExit(f'{wt} has the folder name of the main checkout: both would render from one code copy {default_dst(wt)} — choose '
                         'another --path')
    if git('branch', '--list', br, cwd=main).strip():
        print(f'the branch {br} exists — a worktree on it')
        git('worktree', 'add', str(wt), br, cwd=main)
    else:
        git('worktree', 'add', '-b', br, str(wt), a.base, cwd=main)
    for p, why in shared(main):
        if not (main / p).is_dir():
            if p == 'node_modules':
                print(f'  no node_modules in {main}: run npm ci there, then make the link (mklink /J or ln -s) — npm ci in the worktree '
                      'makes a copy that goes with it')
                continue
            (main / p).mkdir(parents=True)  # a fresh clone: the shared folder is made in the main checkout, never in the worktree
            print(f'  created {main / p}')
        make_link(wt / p, main / p)
        print(f'  link {p} → {main / p} ({why})')
    # the shared folder of the episode (in the main checkout through the episodes link): the time journal of its chapters
    for cd in sorted(p for p in (wt / 'channels').iterdir() if (p / 'episodes').exists()):
        j = cd / 'episodes' / a.ep / 'journal.md'
        if not j.exists():
            j.parent.mkdir(parents=True, exist_ok=True)
            j.write_text(f'# Episode {a.ep} — time journal of the chapters (skill chapter-flow, "Journal")\n\n'
                         '| chapter | story | start | end | h | renders | result |\n|---|---|---|---|---|---|---|\n', encoding='utf-8')
    hp = git('config', '--get', 'core.hooksPath', cwd=main, check=False).strip()
    if not hp and (wt / 'tools' / 'hooks' / 'pre-commit').exists():
        git('config', 'core.hooksPath', 'tools/hooks', cwd=main)  # the lane hook (tools/lane.py hook) — for every checkout of the repository
        print('  commit hook: core.hooksPath = tools/hooks (frozen accepted chapters, lanes, the guard stamp)')
    elif hp.replace('\\', '/').rstrip('/') != 'tools/hooks':
        print(f'  WARNING: core.hooksPath is already "{hp}" — the lane hook is NOT installed: commits are not checked and the guard step '
              'checks every accepted chapter. Set it with git config core.hooksPath tools/hooks, or call tools/hooks/pre-commit from your '
              'own pre-commit hook')
    r = subprocess.run([sys.executable, str(wt / 'tools' / 'api_ref.py'), '--ep', a.ep] + (['--channel', a.channel] if a.channel else []), cwd=wt,
                       capture_output=True, text=True, encoding='utf-8', errors='replace')
    print('  ' + (r.stdout.strip() or r.stderr.strip()[-300:]))
    print(f'\nthe workplace of episode {a.ep}: {wt}\n  branch {br} from {a.base}; the code copy for rendering — {default_dst(wt)}\n'
          f'  session: open Claude Code in {wt} and start with docs/PARALLEL.md, "Starting an episode"')


def cmd_list(a):
    main = main_dir()
    for w in worktrees():
        br = w.get('branch', '(detached)')
        ab = ''
        if br.startswith('ep/'):
            c = git('rev-list', '--left-right', '--count', f'{MAIN}...{br}', cwd=main).split()
            ab = f' · behind {MAIN} {c[0]}, ahead {c[1]}'
        dirty = len([x for x in git('status', '--porcelain', '--untracked-files=no', cwd=w['path'], check=False).splitlines() if x])
        print(f'{w["path"]} · {br}{ab}' + (f' · edits {dirty}' if dirty else '') + (' · main checkout' if Path(w['path']).resolve() == main else ''))


def this_ep() -> str:
    br = git('branch', '--show-current').strip()
    if not br.startswith('ep/'):
        raise SystemExit(f'this is not an episode workplace (branch "{br}", ep/<episode> needed): run the command in the episode worktree')
    return br


def cmd_sync(a) -> int:
    br = this_ep()
    before = git('rev-parse', 'HEAD').strip()
    r = subprocess.run(['git', 'merge', '--no-edit', MAIN], cwd=ROOT, capture_output=True, text=True, encoding='utf-8', errors='replace')
    print((r.stdout or r.stderr).strip()[-1500:])
    if r.returncode:
        print(f'\na merge conflict {MAIN} → {br}: resolve it in this worktree (git status), git commit; then python tools/lane.py guard --since {before[:10]}')
        return 1
    after = git('rev-parse', 'HEAD').strip()
    if after == before:
        print(f'{MAIN} is already in the branch')
        return 0
    print(f'\ncame from {MAIN}: {len(git("diff", "--name-only", before, after).splitlines())} files')
    if a.no_guard:
        print(f'guard of what came: python tools/lane.py guard --since {before[:10]}')
        return 0
    # what came from main and touches accepted chapters (of this branch and of others) — guard of those only
    return subprocess.run([sys.executable, str(ROOT / 'tools' / 'lane.py'), 'guard', '--since', before], cwd=ROOT).returncode


def cmd_land(a) -> int:
    br = this_ep()
    main = main_dir()
    if git('status', '--porcelain', '--untracked-files=no').strip():
        raise SystemExit('the worktree has uncommitted edits of tracked files — commit them (by lanes) or drop them, then land')
    if git('branch', '--show-current', cwd=main).strip() != MAIN:
        raise SystemExit(f'the main checkout {main} is not on {MAIN} — land goes only into {MAIN}')
    if git('status', '--porcelain', '--untracked-files=no', cwd=main).strip():
        raise SystemExit(f'the main checkout {main} has uncommitted edits — it is the merge point and must stay clean')
    if a.push and git('remote', cwd=main).strip():
        r = subprocess.run(['git', 'pull', '--ff-only'], cwd=main, capture_output=True, text=True, encoding='utf-8', errors='replace')
        if r.returncode:
            raise SystemExit(f'git pull --ff-only in the main checkout failed:\n{r.stderr.strip()[-800:]}')
    if cmd_sync(a):
        return 1
    r = subprocess.run(['git', 'merge', '--ff-only', br], cwd=main, capture_output=True, text=True, encoding='utf-8', errors='replace')
    if r.returncode:
        print(r.stderr.strip()[-800:])
        print(f'{MAIN} moved ahead during sync — repeat land')
        return 1
    print(f'{MAIN} → {git("rev-parse", "--short", "HEAD", cwd=main).strip()} ({br})')
    if a.push:
        r = subprocess.run(['git', 'push', 'origin', MAIN], cwd=main, capture_output=True, text=True, encoding='utf-8', errors='replace')
        print((r.stdout + r.stderr).strip()[-600:] or 'push: ok')
        return r.returncode
    return 0


def cmd_remove(a) -> int:
    main = main_dir()
    br = f'ep/{a.ep}'
    w = next((x for x in worktrees() if x.get('branch') == br), None)
    wt = Path(w['path']) if w else ws_path(main, a.ep)
    if w:
        dirty = git('status', '--porcelain', cwd=wt, check=False).strip()  # untracked files too (ignored ones are not listed)
        if dirty and not a.force:
            raise SystemExit(f'{wt} has uncommitted edits or new files:\n{dirty[:800]}\n— commit them or --force')
        sh = shared(main, wt)
        # a shared folder that is a real folder of the worktree (made before its link existed): git status does not list ignored files,
        # so without this check the voice cache, the guard references or the sounds would silently go with the worktree
        own = [p for p, _ in sh if p != 'node_modules' and (wt / p).is_dir() and not is_link(wt / p) and any((wt / p).iterdir())]
        if own and not a.force:
            raise SystemExit(f'{wt} has its own folders where links to the main checkout belong — their content would be removed with the '
                             'worktree:\n  ' + '\n  '.join(own) + f'\n— move the content into the same folders of {main}, or --force')
        for p in own:
            print(f'--force: {wt / p} is removed with the worktree')
        # first the links to the main checkout — rmdir, not recursive; then a check that no link is left
        for p, _ in sh:
            remove_link(wt / p)
        left = []
        for dp, dn, _ in os.walk(wt):
            left += [str(Path(dp) / d) for d in dn if is_link(Path(dp) / d)]
            dn[:] = [d for d in dn if not is_link(Path(dp) / d) and d != '.git']  # do not walk into links
        if left:
            raise SystemExit(f'{wt} still has links — remove them with rmdir yourself, then remove: {left[:5]}')
        # untracked files (docs/API.md, logs) make git refuse without --force; no links are left, so --force touches only the worktree itself
        r = subprocess.run(['git', 'worktree', 'remove', '--force', str(wt)], cwd=main, capture_output=True, text=True, encoding='utf-8', errors='replace')
        if r.returncode:
            raise SystemExit(f'git worktree remove: {r.stderr.strip()[-600:]}')
        print(f'worktree {wt} removed')
    m = default_dst(wt)
    if m == default_dst(main):
        print(f'the code copy {m} has the name of the copy of the main checkout (the same folder name) — not removed')
    elif m.exists():
        remove_link(m / 'node_modules')
        if (m / 'node_modules').exists():
            raise SystemExit(f'{m / "node_modules"} is not a link — the code copy is not removed')
        shutil.rmtree(m)
        (m.parent / f'{m.name}.lock').unlink(missing_ok=True)
        print(f'code copy {m} removed')
    if git('branch', '--list', br, cwd=main).strip():
        merged = br in [x.strip().lstrip('*+ ') for x in git('branch', '--merged', MAIN, cwd=main).splitlines()]
        if merged or a.force:
            git('branch', '-D' if a.force else '-d', br, cwd=main)
            print(f'branch {br} removed' + ('' if merged else f' (not merged into {MAIN} — --force)'))
        else:
            print(f'branch {br} is not merged into {MAIN} — kept (to remove it: --force)')
    return 0


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest='cmd', required=True)
    n = sub.add_parser('new')
    n.add_argument('ep')
    n.add_argument('--base', default=MAIN)
    n.add_argument('--path')
    n.add_argument('--channel', help='the channel of docs/API.md (tools/api_ref.py; default — the only channel)')
    sub.add_parser('list')
    s = sub.add_parser('sync')
    s.add_argument('--no-guard', action='store_true')
    ld = sub.add_parser('land')
    ld.add_argument('--push', action='store_true')
    ld.add_argument('--no-guard', action='store_true')
    r = sub.add_parser('remove')
    r.add_argument('ep')
    r.add_argument('--force', action='store_true')
    a = ap.parse_args()
    return {'new': cmd_new, 'list': cmd_list, 'sync': cmd_sync, 'land': cmd_land, 'remove': cmd_remove}[a.cmd](a) or 0


if __name__ == '__main__':
    sys.exit(main())
