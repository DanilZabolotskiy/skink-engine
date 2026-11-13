"""What the folder registries of a channel declare, read from the TypeScript source without running it — the one parser of tools/lane.py
(which accepted chapters use a kit or a role file) and tools/api_ref.py (docs/API.md).

lib/chapter/registry.ts accepts any shape TypeScript allows, so this reads the shapes a formatter or a person may write:
  export const KIT: KitDef = {id: 'cafe', Kit: CafeKit, cards: cafeCards};          — one kit, keys in any order, either quote style
  export const KIT: KitDef[] = [{id: "a", Kit: A}, B_KIT];                           — a list; an element may be a const of the same file
  export const KIT = {                                                               — over several lines, with comments and trailing commas
    "id": 'cafe',
    Kit: CafeKit,
  } satisfies KitDef;
  export const ROLES: Record<string, Person> = {OSCAR: {…}, 'CLERK_S01E02': person(…)};
A shape it cannot resolve (a spread, a computed key, an id built by a call) is reported as not read: the callers then count the file as
used by every accepted chapter and warn, instead of missing it.
"""
import re

_ID = r'[A-Za-z_$][\w$]*'


def strip_comments(src: str) -> str:
    """The source without // and /* */ comments; strings and template literals are kept as they are (line breaks stay)."""
    out, i, n = [], 0, len(src)
    while i < n:
        c = src[i]
        if c in '\'"`':
            j = _string_end(src, i)
            out.append(src[i:j])
            i = j
        elif src.startswith('//', i):
            j = src.find('\n', i)
            i = n if j < 0 else j
        elif src.startswith('/*', i):
            j = src.find('*/', i + 2)
            out.append('\n' * src.count('\n', i, n if j < 0 else j))
            i = n if j < 0 else j + 2
        else:
            out.append(c)
            i += 1
    return ''.join(out)


def _string_end(src: str, i: int) -> int:
    """The index after the string literal that starts at src[i] (a quote or a backtick)."""
    q, j = src[i], i + 1
    while j < len(src):
        if src[j] == '\\':
            j += 2
            continue
        if src[j] == q:
            return j + 1
        if q != '`' and src[j] == '\n':
            return j  # an unterminated quote: stop at the line end
        j += 1
    return len(src)


def balanced(src: str, i: int) -> int:
    """src[i] is ( [ or { — the index after its matching bracket (strings are skipped)."""
    pairs = {'(': ')', '[': ']', '{': '}'}
    stack, j = [], i
    while j < len(src):
        c = src[j]
        if c in '\'"`':
            j = _string_end(src, j)
            continue
        if c in pairs:
            stack.append(pairs[c])
        elif stack and c == stack[-1]:
            stack.pop()
            if not stack:
                return j + 1
        j += 1
    return len(src)


def split_top(body: str, sep: str = ',') -> list:
    """The parts of a list or object body split at the top level, without the empty tail of a trailing comma."""
    parts, depth, start, j = [], 0, 0, 0
    while j < len(body):
        c = body[j]
        if c in '\'"`':
            j = _string_end(body, j)
            continue
        if c in '([{':
            depth += 1
        elif c in ')]}':
            depth -= 1
        elif c == sep and depth == 0:
            parts.append(body[start:j])
            start = j + 1
        j += 1
    parts.append(body[start:])
    return [p.strip() for p in parts if p.strip()]


def _value(src: str, i: int) -> str:
    """The expression that starts at src[i] up to its end at the top level (; , or the end of a statement)."""
    while i < len(src) and src[i].isspace():
        i += 1
    j = i
    while j < len(src):
        c = src[j]
        if c in '\'"`':
            j = _string_end(src, j)
            continue
        if c in '([{':
            j = balanced(src, j)
            continue
        if c in ';)]}':
            break
        if c == ',' or (c == '\n' and src[i:j].strip() and not re.search(r'[=:.?|&+\-*/<>(,]\s*$', src[i:j])
                         and not re.match(r'\s*(\.|\?|:|as\b|satisfies\b)', src[j:])):
            break
        j += 1
    return src[i:j].strip()


def _bare(expr: str) -> str:
    """An expression without `as const`, `as T`, `satisfies T` and outer parentheses."""
    expr = expr.strip()
    while True:
        m = re.match(r'^(.*?)\s+(?:as|satisfies)\s+[\w$.<>\[\], |\'"]+$', expr, re.S)
        if m and m.group(1).strip():
            expr = m.group(1).strip()
            continue
        if expr.startswith('(') and balanced(expr, 0) == len(expr):
            expr = expr[1:-1].strip()
            continue
        return expr


def const_value(src: str, name: str, exported: bool | None = None) -> str | None:
    """The initializer of `[export] const <name>[: type] = …` (exported=True — only an export, False — only a local const, None — any)."""
    pre = {True: r'\bexport\s+', False: r'(?<!export )', None: r'(?:\bexport\s+)?'}[exported]
    m = re.search(pre + r'\b(?:const|let|var)\s+' + re.escape(name) + r'\b', src)
    if not m:
        return None
    j, depth = m.end(), 0
    while j < len(src):  # skip the type annotation up to "=" at the top level (not "=>")
        c = src[j]
        if c in '\'"`':
            j = _string_end(src, j)
            continue
        if c in '([{<':
            depth += 1
        elif c in ')]}' or (c == '>' and src[j - 1] != '='):
            depth -= 1
        elif c == '=' and depth <= 0 and src[j + 1:j + 2] != '>' and src[j - 1:j] not in ('=', '!', '<', '>'):
            return _bare(_value(src, j + 1))
        elif c == ';':
            return None
        j += 1
    return None


def string_of(expr: str, src: str = '') -> str | None:
    """The value of a string literal ('x', "x", `x` without ${}), or of a const of the same file that holds one."""
    expr = _bare(expr)
    m = re.fullmatch(r"'((?:[^'\\\n]|\\.)*)'|\"((?:[^\"\\\n]|\\.)*)\"|`([^`$\\]*)`", expr, re.S)
    if m:
        return next(g for g in m.groups() if g is not None)
    if src and re.fullmatch(_ID, expr):
        v = const_value(src, expr)
        return string_of(v) if v else None
    return None


def object_props(expr: str) -> dict | None:
    """The top-level properties of an object literal → {key: value text}; None — not an object literal or a key that cannot be read
    (a spread, a computed key). A shorthand property `id` gives {'id': 'id'}."""
    expr = _bare(expr)
    if not expr.startswith('{') or balanced(expr, 0) != len(expr):
        return None
    out = {}
    for p in split_top(expr[1:-1]):
        if p.startswith('...') or p.startswith('['):
            return None
        m = re.match(r"""^(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"|(""" + _ID + r"""|\d+))\s*(?::\s*([\s\S]*))?$""", p)
        if not m:
            m2 = re.match(r'^(?:async\s+)?(' + _ID + r')\s*\(', p)  # a method: name(…) {…}
            if not m2:
                return None
            out[m2.group(1)] = p
            continue
        key = next(g for g in m.groups()[:3] if g is not None)
        out[key] = m.group(4).strip() if m.group(4) is not None else key
    return out


def _resolve(expr: str, src: str, depth: int = 0) -> str:
    """An identifier → the initializer of the const of the same file it names (a few steps), otherwise the expression itself."""
    expr = _bare(expr)
    while depth < 4 and re.fullmatch(_ID, expr):
        v = const_value(src, expr)
        if v is None:
            break
        expr, depth = v, depth + 1
    return expr


def export_value(src: str, name: str) -> str | None:
    """The initializer of what the file exports as `name`: export const NAME = …, or a const exported by export {NAME} / {X as NAME}.
    src — without comments (strip_comments)."""
    v = const_value(src, name, True)
    if v is not None:
        return v
    for b in re.findall(r'\bexport\s*\{([^}]*)\}', src):
        for part in b.split(','):
            m = re.fullmatch(r'\s*(' + _ID + r')(?:\s+as\s+(' + _ID + r'))?\s*', part)
            if m and (m.group(2) or m.group(1)) == name:
                return const_value(src, m.group(1))
    return None


def exports(src: str, name: str) -> bool:
    """The file exports `name` in any form (export const NAME, export {NAME}, export {X as NAME}). src — without comments."""
    return bool(re.search(r'\bexport\s+(?:const|let|var)\s+' + name + r'\b', src)
                or any(re.search(r'(?:^|,)\s*(?:' + _ID + r'\s+as\s+)?' + name + r'\s*(?:,|$)', b) for b in re.findall(r'\bexport\s*\{([^}]*)\}', src)))


def kit_defs(src: str) -> tuple:
    """The kits of a kit file: ([{'id', 'Kit', 'cards'}], read). read is False when the file exports KIT but some kit or its id could not
    be read; a file without KIT (a kit helper) gives ([], True)."""
    s = strip_comments(src)
    if not exports(s, 'KIT'):
        return [], True
    v = export_value(s, 'KIT')
    if v is None:
        return [], False
    v = _resolve(v, s)
    items = split_top(v[1:-1]) if v.startswith('[') and balanced(v, 0) == len(v) else [v]
    out, ok = [], True
    for it in items:
        props = object_props(_resolve(it, s))
        kid = string_of(props['id'], s) if props and 'id' in props else None
        if not kid:
            ok = False
            continue
        comp = _bare(props.get('Kit', ''))
        cards = _bare(props['cards']) if 'cards' in props else None
        out.append({'id': kid, 'Kit': comp if re.fullmatch(_ID, comp) else (comp[:40] or None), 'cards': cards})
    return out, ok


def role_defs(src: str, name: str = 'ROLES', exported: bool | None = True) -> tuple:
    """The roles of an object `const NAME = {ROLE: person, …}` → ({role: value text}, read). A file without NAME gives ({}, True); a
    spread or a computed key gives read False."""
    s = strip_comments(src)
    if exported and not exports(s, name):
        return {}, True
    v = export_value(s, name) if exported else const_value(s, name)
    if v is None:
        return {}, not exported
    props = object_props(_resolve(v, s))
    return (props, True) if props is not None else ({}, False)


def number(expr: str, key: str) -> str:
    """A numeric property `key: 1.7` of an object literal text (for a table), or ''."""
    m = re.search(r'\b' + key + r'\s*:\s*([\d.]+)', expr or '')
    return m.group(1) if m else ''
