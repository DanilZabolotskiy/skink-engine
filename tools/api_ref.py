"""API reference of the kits and the staging layer of a channel — docs/API.md, generated from the code, so that agents use kits without
reading their sources.

python tools/api_ref.py [--channel ID] [--out docs/API.md]   # write it (the channel — the only one in channels/ by default)
python tools/api_ref.py --check                               # exit code 1 — the reference is stale (the code changed since)
python tools/api_ref.py --ep s01e02                           # the episode (role words, verbs); default — from the branch ep/<episode>

docs/API.md is not in git (.gitignore): every checkout, an episode worktree too, writes its own (docs/PARALLEL.md). Sources: the kits
chapter/kits/*.tsx (the file header, the export KIT — lib/chapter/registry.ts); in the code of a kit — the events it reads (actions of the
library), the prop states (propAt), the look targets (lookK, gazeBy), the text it draws itself (KIT.cards); the channel config merged with
the part files (pipeline/channel.json + parts/*.json: locations, views, roles, role words, actions and verbs), the sounds (sfx.json + parts);
lib/staging/actions.json (actions, poses, verbs); lib/character/looks.ts (look, holds), lib/character/body.ts (gesture fields), the roles of
chapter/cast.tsx and chapter/roles/*.tsx, Figure (lib/chapter/figure.tsx); the exports of the shared modules with the first sentence of
their comment. The reference is not edited by hand: an edit goes into the code or its comment, then a new run.
"""
import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from tools.pipeline.common import Channel  # noqa: E402

MODULES = ['lib/staging/stage.ts', 'lib/staging/journal.tsx', 'lib/staging/walk.ts', 'lib/chapter/room.tsx', 'lib/chapter/figure.tsx',
           'lib/chapter/registry.ts', 'lib/chapter/grade.ts', 'lib/persp/persp.ts', 'lib/fx/fx.tsx', 'lib/hud/hud.tsx', 'lib/anim.ts']
BIG = {'room.tsx', 'hud.tsx'}  # large modules: names without signatures


def read(p: Path) -> str:
    return p.read_text(encoding='utf-8')


def header(src: str) -> list:
    """The file header: the // lines before the first line of code."""
    out = []
    for ln in src.splitlines():
        if not ln.startswith('//'):
            break
        out.append(ln[2:].rstrip())
    return out


def first_sentence(s: str, n=170) -> str:
    s = re.sub(r'\s+', ' ', s).strip()
    m = re.search(r'(?<=[.;])\s+(?=[A-Z(])', s)
    s = s[:m.start()] if m else s
    return s if len(s) <= n else s[:n - 1].rstrip() + '…'


def balanced(src: str, i: int, op='(', cl=')') -> str:
    """The text from src[i] == op to its matching bracket inclusive (strings are not parsed — enough for these calls)."""
    d = 0
    for j in range(i, len(src)):
        if src[j] == op:
            d += 1
        elif src[j] == cl:
            d -= 1
            if d == 0:
                return src[i:j + 1]
    return src[i:]


def obj_keys(lit: str) -> list:
    """The top-level keys of an object literal {a: …, b: …}."""
    keys, d, k = [], 0, 0
    body = lit[1:-1]
    while k < len(body):
        c = body[k]
        if c in '([{':
            d += 1
        elif c in ')]}':
            d -= 1
        elif d == 0:
            m = re.match(r'\s*,?\s*([A-Za-z_]\w*)\s*:', body[k:])
            if m and (k == 0 or body[k] == ',' or body[:k].strip() == ''):
                keys.append(m.group(1))
                k += m.end()
                continue
        k += 1
    return keys


def ts_fields(src: str, name: str) -> list:
    """Fields of `export type <name> = {…};` with their line comments."""
    m = re.search(rf'export type {name} = \{{(.*?)\n\}};', src, re.S)
    out = []
    for ln in (m.group(1).splitlines() if m else []):
        mm = re.match(r'\s*(\w+)(\??):\s*([^;]+);\s*(?://\s*(.*))?$', ln)
        if mm:
            out.append(f'`{mm.group(1)}{mm.group(2)}: {mm.group(3).strip()}`' + (f' — {mm.group(4).strip()}' if mm.group(4) else ''))
    return out


def jsdoc_before(src: str, decl: str) -> str:
    """The /** … */ comment right before a declaration, as one line."""
    i = src.find(decl)
    j = src.rfind('/**', 0, i)
    if i < 0 or j < 0 or src[src.find('*/', j) + 2:i].strip():
        return ''
    return re.sub(r'\s+', ' ', re.sub(r'\n\s*\*', ' ', src[j + 3:src.find('*/', j)])).strip()


# ---------- kits ----------

def kit_registry(cdir: Path) -> list:
    """Kits of the registry: files chapter/kits/*.tsx with an export KIT = {id, Kit, cards} (lib/chapter/registry.ts)."""
    out = []
    for p in sorted((cdir / 'chapter' / 'kits').glob('*.tsx')):
        for kid, comp, cards in re.findall(r"\{id: '([\w-]+)', Kit: (\w+)(?:, cards: (\w+))?\}", read(p)):
            out.append((kid, comp, p.stem, cards or None))
    return out


def kit_sources(cdir: Path, f: str, registered: set) -> tuple:
    """The kit file and its helpers — kits/*.tsx it imports that are not in the registry (transitively). Imported registered kits — apart:
    their events are in their own section."""
    seen, kits, todo = [], [], [f]
    while todo:
        x = todo.pop(0)
        if x in seen or x in kits or not (cdir / 'chapter' / 'kits' / f'{x}.tsx').exists():
            continue
        if x != f and x in registered:
            kits.append(x)
            continue
        seen.append(x)
        todo += re.findall(r"from '\./(\w+)'", read(cdir / 'chapter' / 'kits' / f'{x}.tsx'))
    return seen, kits


def kit_events(src: str, names: set) -> list:
    found = set()
    for lit in re.findall(r"['\"`]([a-z]+(?:\.[a-z]+)?\.?)['\"`]", src):
        if lit in names:
            found.add(lit)
        elif lit.endswith('.') and any(n.startswith(lit) for n in names):
            found.add(lit + '*')
    return sorted(found)


def kit_props(src: str) -> list:
    out = set()
    for m in re.finditer(r'propAt\(', src):
        parts = [a.strip() for a in re.split(r',(?![^(]*\))', balanced(src, m.end() - 1)[1:-1])]
        if len(parts) < 3:
            continue
        obj, key = parts[1], parts[2]
        obj = re.sub(r'\$\{[^}]*\}', 'N', obj.strip('\'"`')) if re.match(r"^['\"`]", obj) else f'<{obj}>'
        key = key.strip('\'"`') if re.match(r"^['\"`]", key) else f'<{key}>'
        out.add(f'{obj}.{key}')
    return sorted(out)


def kit_looks(src: str) -> list:
    out = set(re.findall(r"lookK\([^()]*?,\s*[^,()]+,\s*[^,()]+,\s*'(\w+)'\)", src))
    for m in re.finditer(r'gazeBy\(', src):
        call = balanced(src, m.end() - 1)
        i = call.find('{')
        if i > 0:
            out.update(obj_keys(balanced(call, i, '{', '}')))
        out.update(re.findall(r"'(\w+)'\s*\)$", call))
    return sorted(out)


def kits_section(cdir: Path, cfg: dict, names: set) -> list:
    locs = cfg.get('locations', {})
    L = ['## 1. Location kits', '',
         'A kit is a file `chapter/kits/<file>.tsx` with an export `KIT = {id, Kit, cards}` (a registry by folder, `lib/chapter/registry.ts`); a '
         'script location → a kit and its views — `pipeline/channel.json` → `locations` or an episode file `pipeline/parts/<episode>.json` → '
         '`channel.locations` (docs/PARALLEL.md). The view of a shot is the first `views` rule matching the camera line (`cam`) and ON SCREEN '
         '(`on`). "Events" — library actions (section 2) the kit code reads; "states" — `propAt(obj, key)`; "look targets" — targets of '
         '`look … to` (`lookK`, `gazeBy`). Figures of roles are drawn by `Figure` (`lib/chapter/figure.tsx`): every kit with figures understands '
         '`gesture`, `look` and `walk`.', '']
    reg = kit_registry(cdir)
    registered = {f for _, _, f, _ in reg}
    for name, comp, f, cards in reg:
        L += [f'### `{name}` — `chapter/kits/{f}.tsx` ({comp})', '']
        for lid, lc in locs.items():
            if lc.get('kit') != name:
                continue
            amb = lc.get('ambience')
            amb = ', '.join(f'{k}: {v}' for k, v in amb.items()) if isinstance(amb, dict) else amb
            L.append(f'- Location `{lid}`: {lc.get("about", "")}' + (f' · ambience: {amb}' if amb else '') + (' · the kit moves the camera (drift)' if lc.get('drift') else ''))
            vs = [v['view'] + (' ← ' + ' '.join(f'{k}:/{v[k]}/' for k in ('cam', 'on') if v.get(k)) if v.get('cam') or v.get('on') else ' (otherwise)')
                  for v in lc.get('views') or []]
            if vs:
                L.append('  - views: ' + ' · '.join(vs))
        srcs, uses = kit_sources(cdir, f, registered)
        src = '\n'.join(read(cdir / 'chapter' / 'kits' / f'{x}.tsx') for x in srcs)
        hd = [h.strip() for h in header(read(cdir / 'chapter' / 'kits' / f'{f}.tsx')) if h.strip()]
        if hd:
            L += ['- File header:'] + ['  > ' + h for h in hd]
        for title, items in (('Events in the code', kit_events(src, names)), ('States (`set` / events)', kit_props(src)), ('Look targets', kit_looks(src))):
            if items:
                L.append(f'- {title}: ' + ', '.join(f'`{x}`' for x in items))
        if 'Figure' in src:
            L.append('- Figures of roles: `Figure` (gesture, look, path)')
        if cards:
            m = re.search(rf'export const {cards} = \([^)]*\) => (.+?);\s*$', src, re.M)
            if m:
                L.append(f'- Text of the kit (not repeated as a card, `KIT.cards`): `{m.group(1).strip()}`')
        if len(srcs) > 1:
            L.append('- Helpers (their events are above): ' + ', '.join(f'`kits/{x}.tsx`' for x in srcs[1:]))
        if uses:
            L.append('- Takes from the kits: ' + ', '.join(f'`kits/{x}.tsx`' for x in uses))
        L.append('')
    return L


# ---------- actions, poses, verbs ----------

def actions_section(lib: dict, cfg: dict) -> list:
    own = cfg.get('actions') or {}
    acts = {**lib['actions'], **own}
    L = ['## 2. Staging actions — `staging.json` → `events[].do`', '',
         '`lib/staging/actions.json` (+ the channel: `channel.json` or a part file → `actions`, marked ◆). The event format and the layer rules — '
         '`docs/STAGING.md`. Event time: `"u": [shot fractions]` or `"t": [s]`. "State" — which field of the prop `obj` the action drives '
         '(from → to); sound — `[id, progress fraction | start | end, offset s]`; hand — the event needs `who` with a gesture at the start of '
         'the motion (or `hand` / `by` with a reason).', '',
         '| do | state | length, s | sound | hand, fields |', '|---|---|---|---|---|']
    for k in sorted(acts):
        a = acts[k]
        st = f'{a["prop"]}: {a.get("from", "·")} → {a.get("to", "·")}' if a.get('prop') else ''
        snd = ', '.join(f'{s[0]}@{s[1]}' + (f'{s[2]:+g}' if len(s) > 2 and s[2] else '') for s in a.get('sfx') or [])
        if a.get('offscreen'):
            snd += f' (out of frame: {", ".join(a["offscreen"])})'
        need = ('hand' if a.get('hand') is True else '') + (f' need: {", ".join(a["need"])}' if a.get('need') else '')
        L.append(f'| `{k}`{" ◆" if k in own else ""} | {st} | {a.get("dur", "")} | {snd} | {need.strip()} |')
    if cfg.get('_doc_actions'):
        L += ['', '◆ ' + cfg['_doc_actions']]
    poses = {**(lib.get('poses') or {}), **(cfg.get('poses') or {})}
    L += ['', '## 3. Gesture poses — `gesture` → `pose`', '', 'Solved by `lib/character/body.ts`, drawn by the drawing style; the hand point '
          '`reach` (a handle, a rail) comes from the kit.', ''] + [f'- `{k}` — {v}' for k, v in poses.items()]
    body = read(ROOT / 'lib' / 'character' / 'body.ts')
    m = re.search(r'export type BodyGest = \{([^}]*)\};', body)
    if m:
        L += ['', f'Gesture fields (`BodyGest`): `{m.group(1).strip()}` — {jsdoc_before(body, "export type BodyGest")}']
    L += ['', '## 4. Shot line → event', '',
          'A verb of ON SCREEN / camera needs an event of the one who acts (`@`); the `verbs` check of precheck. The channel (`action_verbs`) '
          'goes first. A variant: `<do>[:<pose|to|obj|pace>][!<field>][@]`, `sfx:<id>` — a sound of the shot, `line@` — a line.', '']
    for v in (cfg.get('action_verbs') or []) + (lib.get('verbs') or []):
        L.append(f'- {v.get("what", "")}: ' + ' | '.join(f'`{n}`' for n in v.get('need') or []))
    return L


# ---------- characters ----------

def role_rows(src: str, start: str) -> list:
    """[(role, height, holds)] of an object `start = {ROLE: {…}, …}` in a cast or a role file."""
    i = src.find(start)
    if i < 0:
        return []
    body = balanced(src, src.index('{', src.index('=', i)), '{', '}')
    rows = []
    for m in re.finditer(r'^  (\w+): \{', body, re.M):
        chunk = balanced(body, m.end() - 1, '{', '}')
        h = re.search(r'\bh: ([\d.]+)', chunk)
        hold = re.search(r'hold: \[([^\]]+)\]', chunk)
        rows.append((m.group(1), h.group(1) if h else '', hold.group(1).replace("'", '') if hold else ''))
    return rows


def cast_section(cdir: Path, cfg: dict) -> list:
    looks = read(ROOT / 'lib' / 'character' / 'looks.ts')
    L = ['## 5. Characters', '']
    m = re.search(r'export type Hold = ([^;]+);', looks)
    if m:
        L += ['**Holds** (`Hold`, `look.hold` and `staging.json` → `cast[].hold`: `[right, left]` hand of the figure — from behind the prop stays in '
              'the same hand): ' + ', '.join(f'`{x.strip()}`'.replace("'", '') for x in m.group(1).split('|')) + '.', '',
              jsdoc_before(looks, 'export type Hold'), '']
    L += ['**Look** (`Look`, `lib/character/looks.ts`):', ''] + [f'- {x}' for x in ts_fields(looks, 'Look')]
    L += ['', '**Face features** (`FaceFeatures`): ' + '; '.join(ts_fields(looks, 'FaceFeatures')), '']
    notes = cfg.get('cast') or {}
    rows = [(who, 'chapter/cast.tsx', h, hold) for who, h, hold in role_rows(read(cdir / 'chapter' / 'cast.tsx'), 'CAST')]
    for p in sorted((cdir / 'chapter' / 'roles').glob('*.tsx')):
        rows += [(who, f'chapter/roles/{p.name}', h, hold) for who, h, hold in role_rows(read(p), 'export const ROLES')]
    L += ['**Roles** (regulars — `chapter/cast.tsx`; the roles of an episode — `chapter/roles/<episode>.tsx` → `ROLES`; `cast` of the config — '
          'roles with a figure. A new role of an episode — in its role file and in `pipeline/parts/<episode>.json` → `channel.cast`):', '',
          '| role | file | height, m | `look.hold` | note |', '|---|---|---|---|---|']
    L += [f'| `{who}` | `{f}` | {h} | {hold} | {(notes.get(who) or {}).get("note", "")} |' for who, f, h, hold in rows]
    figure = read(ROOT / 'lib' / 'chapter' / 'figure.tsx')
    L += ['', '**`Figure`** — the figure of a role in a kit (`lib/chapter/figure.tsx`, `FigureOpts`):', ''] + [f'- {x}' for x in ts_fields(figure, 'FigureOpts')]
    em = read(ROOT / 'lib' / 'character' / 'emotions.ts')
    emo = re.findall(r'^\s+(\w+): \{browY', em, re.M)
    if emo:
        L += ['', '**Emotions** (`lib/character/emotions.ts`; script words — `tools/pipeline/timeline.py` → `EMO_WORDS`): ' + ', '.join(f'`{e}`' for e in emo) + '.']
    return L


# ---------- channel.json, sfx.json ----------

def channel_section(cfg: dict) -> list:
    L = ['## 6. `pipeline/channel.json` (merged with the part files)', '', '| key | what |', '|---|---|']
    docs = {k[5:]: v for k, v in cfg.items() if k.startswith('_doc_')}
    for k, v in cfg.items():
        if k.startswith('_doc'):
            continue
        if isinstance(v, (dict, list)):
            js = json.dumps(v, ensure_ascii=False)
            what = docs.get(k, '')
            L.append(f'| `{k}` | {js if len(js) <= 160 else f"{type(v).__name__}, {len(v)} items"}' + (f' — {first_sentence(what, 260)}' if what else '') + ' |')
        else:
            L.append(f'| `{k}` | `{v}` |')
    if cfg.get('_doc'):
        L += ['', cfg['_doc']]
    rest = [(k, v) for k, v in docs.items() if k not in cfg]
    if rest:
        L += [''] + [f'- `{k}`: {v}' for k, v in rest]
    stubs = [k for k, v in cfg.get('locations', {}).items() if not v.get('kit')]
    if stubs:
        L += ['', '**Locations without a kit** (a stub): ' + ', '.join(f'`{k}`' for k in stubs) + '.']
    cw = cfg.get('cast_words') or []
    if cw:
        L += ['', '**Who is in the frame by words** (`cast_words`, every match in ON SCREEN and camera; `not` — an exception):', '']
        L += [f'- `{w["who"]}` ← `/{w["re"]}/`' + (f' except `/{w["not"]}/`' if w.get('not') else '') for w in cw]
    if cfg.get('cast_pron'):
        L += ['', '**Role pronouns** (`cast_pron`): ' + '; '.join(f'{k}: {", ".join(v)}' for k, v in cfg['cast_pron'].items()) + ' (the rest — he).']
    return L


def sfx_section(s: dict) -> list:
    L = ['## 7. Sounds — `pipeline/sfx.json`', '',
         'A script sound finds its entry by id or `match`. New sounds are generated only on the owner\'s request: a sound without a file is silence '
         'and a line in `audio/sfx_missing.md`. A loop with `needs` — its source must be visible in the shot where it starts.', '',
         '| id | group | kind | file, note |', '|---|---|---|---|']
    for k, v in (s.get('sounds') or {}).items():
        kind = 'bed' if v.get('bed') or str(k).startswith('amb_') else ('loop' if v.get('loop') else 'one-shot')
        if v.get('needs'):
            kind += f', needs: {v["needs"]}'
        f = Path(v.get('file') or '').stem
        L.append(f'| `{k}` | {v.get("group", "")} | {kind} | {f"file {f}" if f and f != k else ""}{"; off" if v.get("off") else ""} |')
    if s.get('planned'):
        L += ['', 'To generate (only on the owner\'s request): ' + ', '.join(f'`{k}`' for k in s['planned']) + '.']
    return L


# ---------- modules ----------

def exports(path: Path, names_only=False, n=120) -> list:
    lines = read(path).splitlines()
    out, doc = [], []
    i = 0
    while i < len(lines):
        s = lines[i].strip()
        if s.startswith('/**'):
            block = [s]
            while '*/' not in lines[i] and i + 1 < len(lines):
                i += 1
                block.append(lines[i].strip())
            doc = [re.sub(r'^/\*\*|\*/$|^\*\s?', '', b).strip() for b in block]
            i += 1
            continue
        m = re.match(r'export (?:default )?(function|const|type|class|let)\s+(\w+)(.*)', s)
        if m:
            kind, name, rest = m.groups()
            tail = re.search(r'//\s*(.+)$', rest)
            text = ' '.join(x for x in doc if x) or ('' if names_only else (tail.group(1) if tail else ''))
            if names_only:
                sig = ('type ' if kind == 'type' else '') + name
            elif kind == 'function':
                sig = name + re.sub(r'\s*\{\s*$', '', rest)
            elif kind == 'type':
                sig = 'type ' + name
            else:
                am = re.match(r'(?::\s*[^=]+)?\s*=\s*(\([^)]*\))\s*(?::\s*[^=]+)?=>', rest)
                sig = name + (am.group(1) if am else '')
            sig = sig if len(sig) <= 110 else sig[:109] + '…'
            if text or (kind == 'function' and not names_only):
                out.append(f'- `{sig}`' + (f' — {first_sentence(text, n)}' if text else ''))
        if s and not s.startswith('//'):
            doc = []
        i += 1
    return out


def modules_section() -> list:
    L = ['## 8. Shared modules — exports', '', 'The signature and the first sentence of the comment. A kit moves things only through `beat`, '
         '`eventOf`, `propAt`, `lookK`, `cutIndexAt`, `hold`, `gestAt` (`lib/staging/stage.ts`): no own times in kit code (`docs/STAGING.md`).', '']
    for m in MODULES:
        p = ROOT / m
        if not p.exists():
            continue
        big = p.name in BIG
        ex = exports(p, names_only=big, n=80 if big else 120)
        if ex:
            hd = header(read(p))
            L += [f'### `{m}`' + (f' — {first_sentence(" ".join(hd), 200)}' if hd else ''), ''] + ex + ['']
    return L


def default_channel() -> str:
    chs = sorted(p.name for p in (ROOT / 'channels').iterdir() if (p / 'pipeline' / 'channel.json').exists())
    if len(chs) != 1:
        raise SystemExit(f'channels: {", ".join(chs) or "none"} — choose one with --channel')
    return chs[0]


def build(channel: str, ep: str | None = None) -> str:
    cdir = ROOT / 'channels' / channel
    chn = Channel(cdir, ep)  # the channel config merged with the part files; role words and verbs — of the episode ep
    cfg = chn.cfg
    lib = json.loads(read(ROOT / 'lib' / 'staging' / 'actions.json'))
    names = set(lib['actions']) | set(cfg.get('actions') or {})
    L = [f'# API reference — kits, staging, characters (channel {channel}' + (f', episode {ep}' if ep else '') + ')', '',
         '**Generated** by `python tools/api_ref.py` from the code and the configs — do not edit by hand. `python tools/api_ref.py --check` — exit '
         'code 1 if the code changed after the generation (then run it without `--check`). Read the source of a kit only to copy or edit it.', '',
         'Contents — line numbers of this file: read the sections you need (`Read` with offset / limit), not the whole file; of the kits — only '
         'those the chapter needs.', '']
    body = []
    for sec in (kits_section(cdir, cfg, names), actions_section(lib, cfg), cast_section(cdir, cfg), channel_section(cfg), sfx_section(chn.sfx),
                modules_section()):
        body += sec + ['']
    body = '\n'.join(body).split('\n')  # items with line breaks become real lines, otherwise the line numbers of the contents drift
    heads = [(i, ln) for i, ln in enumerate(body) if ln.startswith('## ') or (ln.startswith('### `') and ' — `chapter/kits/' in ln)]
    off = len(L) + len(heads) + 1  # the lines of the contents and the empty line after them
    toc = []
    for k, (i, ln) in enumerate(heads):
        end = (heads[k + 1][0] if k + 1 < len(heads) else len(body)) + off
        name = re.sub(r' — `chapter/.*', '', ln.lstrip('# ')) if ln.startswith('### ') else ln[3:]
        toc.append(('  - ' if ln.startswith('### ') else '- ') + f'{name}: lines {i + off + 1}–{end}')
    return '\n'.join(L + toc + [''] + body).rstrip() + '\n'


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--channel', help='the channel (default — the only one in channels/)')
    ap.add_argument('--out', type=Path, help='default docs/API.md')
    ap.add_argument('--check', action='store_true', help='compare with the file: 1 — stale')
    ap.add_argument('--ep', help='the episode (s01e02): role words and verbs of its part files; default — from the branch ep/<episode>')
    a = ap.parse_args()
    out = a.out or ROOT / 'docs' / 'API.md'
    if not a.ep:
        br = subprocess.run(['git', 'branch', '--show-current'], cwd=ROOT, capture_output=True, text=True).stdout.strip()
        a.ep = br[3:] if br.startswith('ep/') else None
    text = build(a.channel or default_channel(), a.ep)
    if a.check:
        if (out.read_text(encoding='utf-8') if out.exists() else '') != text:
            print(f'{out}: stale — python tools/api_ref.py')
            return 1
        print(f'{out}: up to date')
        return 0
    out.write_text(text, encoding='utf-8', newline='\n')
    print(f'{out}: {len(text)} characters, {text.count(chr(10))} lines')
    return 0


if __name__ == '__main__':
    sys.exit(main())
