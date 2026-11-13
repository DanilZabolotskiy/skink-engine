"""Rules by role: the common rules of the chapter agents and the sections of the files of a role's reading list — in one print, without
reading the files whole.

python tools/read_role.py <role>       # A, B, C, R, F — print (roles and lists — .claude/skills/chapter-flow/reading.md)
python tools/read_role.py --list       # the roles and the size of their reading, characters
python tools/read_role.py --check      # are all files, sections and items of the lists found; 1 — no (a section renamed, rules renumbered)
python tools/read_role.py --sec <file> "<section>" ["<section>" …]        # sections of any file (items named in findings)
python tools/read_role.py --sec docs/PRODUCTION_RULES.md "rules 4d, 7"    # numbered items

A list line: "- `path`" — the whole file; "- `path` § Section; Other section" — sections by the start of their heading (any level, with
their subsections); "- `path` rules 1–4, 9a, 12" — numbered items "N. **…**" (a range takes the lettered ones too: 4a, 4b). Text after
" — " is a note. Other lines of a role section are printed as they are (instructions of the role).
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LIST = ROOT / '.claude' / 'skills' / 'chapter-flow' / 'reading.md'
ITEM = re.compile(r'^- `([^`]+)`\s*(?:(§|rules)\s*(.*?))?(?:\s+—\s+.*)?$')
COMMON = 'All'  # the section every role reads first, unless its heading says "(no common)"
RULE = re.compile(r'^(?:\s*-\s+)?(\d+[a-z]?)\.\s')  # a numbered item, also as a sub-item bullet: "   - 4a. **…**"


def roles() -> dict:
    """Sections of reading.md: "## <code> — …" → lines."""
    out, cur, fence = {}, None, False
    for ln in LIST.read_text(encoding='utf-8').splitlines():
        if ln.startswith('```'):
            fence = not fence
        m = None if fence else re.match(r'^## (\S+)', ln)
        if m:
            cur = m.group(1)
            out[cur] = [ln]
        elif cur:
            out[cur].append(ln)
    return out


def sections(text: str, names: list) -> list:
    """Sections by the start of their heading: (heading, the text up to the next heading of the same or a higher level)."""
    lines = text.splitlines()
    heads = [(i, len(m.group(1)), m.group(2).strip()) for i, ln in enumerate(lines) for m in [re.match(r'^(#+)\s+(.*)$', ln)] if m]
    got = []
    for n in names:
        key = n.strip().lower()
        hit = next(((i, lv, h) for i, lv, h in heads if re.sub(r'^[\d.]+\s*', '', h).lower().startswith(key) or h.lower().startswith(key)), None)
        if not hit:
            got.append((n, None))
            continue
        i, lv, h = hit
        end = next((j for j, l2, _ in heads if j > i and l2 <= lv), len(lines))
        got.append((h, '\n'.join(lines[i:end]).rstrip()))
    return got


def items(text: str, spec: str) -> list:
    """Numbered items "N. **…**": "1–4, 9a" → the texts of the items (an item ends at the next item or heading)."""
    lines = text.splitlines()
    starts = [(i, m.group(1)) for i, ln in enumerate(lines) for m in [RULE.match(ln)] if m]
    want = []
    for part in re.split(r'\s*,\s*', spec.strip()):
        r = re.match(r'^(\d+)\s*[–-]\s*(\d+)$', part)
        if r:
            a, b = int(r.group(1)), int(r.group(2))
            want += [num for _, num in starts if a <= int(re.match(r'\d+', num).group()) <= b]
        elif part:
            want.append(part)
    got = []
    for w in dict.fromkeys(want):
        k = next((k for k, (_, num) in enumerate(starts) if num == w), None)
        if k is None:
            got.append((f'rule {w}', None))
            continue
        i = starts[k][0]
        end = next((j for j in range(i + 1, len(lines)) if RULE.match(lines[j]) or lines[j].startswith('#')), len(lines))
        got.append((f'rule {w}', '\n'.join(lines[i:end]).rstrip()))
    return got


def render(code: str, rs: dict) -> tuple:
    """The text of a role and the list of what was not found."""
    out, miss = [], []
    common = rs.get(COMMON, [])[1:] if code != COMMON and '(no common)' not in rs[code][0] else []
    for ln in common + rs[code][1 if code == '_' else 0:]:
        m = ITEM.match(ln.strip())
        if not m:
            out.append(ln)
            continue
        path, kind, spec = m.group(1), m.group(2), m.group(3) or ''
        p = ROOT / path
        if not p.exists():
            miss.append(f'{path}: no file')
            continue
        text = p.read_text(encoding='utf-8')
        if not kind:
            out += [f'\n===== {path} =====', text.rstrip()]
            continue
        parts = sections(text, [s for s in spec.split(';') if s.strip()]) if kind == '§' else items(text, spec)
        for name, body in parts:
            if body is None:
                miss.append(f'{path}: no "{name.strip()}"')
            else:
                out += [f'\n===== {path} — {name} =====', body]
    return '\n'.join(out).strip() + '\n', miss


def main():
    a = sys.argv[1:]
    sys.stdout.reconfigure(encoding='utf-8')
    if not a or a[0] in ('-h', '--help'):
        print(__doc__)
        return 0
    if a[0] == '--sec':  # sections of any file: --sec <file> "<section>" […] | "rules 4d, 7"
        if len(a) < 3:
            print('--sec <file> "<section>" […] or "rules 1–4, 9a"')
            return 2
        text, miss = render('_', {'_': ['## _ (no common)'] + [f'- `{a[1]}` ' + (s if s.startswith('rules') else '§ ' + s) for s in a[2:]]})
        print(text)
        if miss:
            print('NOT FOUND: ' + '; '.join(miss))
        return 1 if miss else 0
    rs = roles()
    if a[0] in ('--list', '--check'):
        bad = 0
        for code in rs:
            if code == COMMON:
                continue
            text, miss = render(code, rs)
            print(f'{code}: {len(text)} characters' + (f' · not found: {"; ".join(miss)}' if miss else ''))
            bad += bool(miss)
        return 1 if a[0] == '--check' and bad else 0
    code = a[0]
    if code not in rs:
        print(f'no role "{code}"; there are: {", ".join(k for k in rs if k != COMMON)}')
        return 2
    text, miss = render(code, rs)
    print(text)
    if miss:
        print('NOT FOUND (tell the orchestrator): ' + '; '.join(miss))
    return 0


if __name__ == '__main__':
    sys.exit(main())
