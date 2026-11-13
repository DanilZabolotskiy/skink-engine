"""Step 1: chapter script (docs/SCRIPT_FORMAT.md) → scenes.json. Checks: location, preset, speaker, line language.

python tools/pipeline/parse.py <script.md> [--lang en] [--out scenes.json]
"""
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from tools.pipeline.common import Channel, PipelineError, channel_dir, has_hangul, save_json  # noqa: E402

RE_SCENE = re.compile(r'^##\s*SCENE\s+(\d+)\s*(?:[—–-]+\s*([^|]*?))?\s*(?:\|(.*))?$', re.I)
RE_SHOT = re.compile(r'^###\s*SHOT\s+(\d+)\.(\d+)\s*(?:\|\s*([\d.,]+)\s*s(?:ec)?\b)?\s*(?:\|(.*))?$', re.I)
RE_FIELD = re.compile(r'^(ON SCREEN|TEXT|VO|DIALOGUE|SFX|NOTE)\s*(?:\(([^)]*)\))?\s*:\s*(.*)$', re.I)
QUOTE = re.compile(r'["“”«»]([^"“”«»]*)["“”«»]')


def split_top(s: str, sep=';'):
    """Splits by sep outside quotes."""
    out, cur, q = [], '', False
    for ch in s:
        if ch in '"“”«»':
            q = not q
        if ch == sep and not q:
            out.append(cur.strip())
            cur = ''
        else:
            cur += ch
    if cur.strip():
        out.append(cur.strip())
    return out


def kv(s: str) -> dict:
    d = {}
    for part in s.split('|'):
        m = re.match(r'^\s*([\w-]+)\s*:\s*(.*)$', part)  # "key: value"; "target_duration 8:10" — the key up to the space
        if m:
            d[m.group(1).lower()] = m.group(2).strip()
        elif part.strip():
            w = part.strip().split(None, 1)
            d[w[0].lower()] = w[1] if len(w) > 1 else ''
    return d


def strip_quotes(s: str) -> str:
    s = s.strip()
    if len(s) >= 2 and s[0] in '"“«' and s[-1] in '"”»':
        return s[1:-1].strip()
    return s


def parse_text(raw: str):
    items = []
    for it in split_top(raw):
        qs = QUOTE.findall(it)
        head = re.sub(r'\s{2,}', ' ', re.sub(r'\s*/\s*', ' ', QUOTE.sub('', it))).strip(' :,-/').lower()
        if head.startswith('title bar'):
            items.append({'kind': 'bar', 'title': qs[0] if qs else head[9:].strip()})
        elif head.startswith('counter'):
            # counter 1–5, 2 lit | counter 1–5, 2 crossed | counter off
            m = re.search(r'(\d+)\s*[–-]\s*(\d+)', it)
            cur = re.search(r'(\d+)\s+(lit|on|crossed|active)\b', it, re.I)
            n = int(cur.group(1)) if cur else 0
            items.append({'kind': 'counter', 'total': int(m.group(2)) if m else max(n, 1), 'current': n,
                          'crossed': [n] if cur and cur.group(2).lower() == 'crossed' else [],
                          'hidden': bool(re.search(r'\b(off|hidden|hide)\b', head))})
        elif head.startswith('place'):
            lines = [x.strip() for x in (qs[0] if qs else '').split('·', 1)] if qs else []
            items.append({'kind': 'place', 'lines': [x for x in lines if x]})
        elif head.startswith('stamp'):
            items.append({'kind': 'stamp', 'text': qs[0] if qs else ''})
        elif head.startswith('episode'):
            items.append({'kind': 'episode', 'text': qs[0] if qs else ''})
        else:
            items.append({'kind': 'card', 'label': head, 'text': ' / '.join(qs) if qs else it})
    return items


def parse_sfx(raw: str):
    sfx, music = [], []
    for it in split_top(raw):
        m = re.match(r'^MUSIC\s*:\s*(.*)$', it, re.I)
        if m:
            parts = [p.strip() for p in m.group(1).split(',')]
            mood, dur, src, at = parts[0] if parts else '', None, None, 0.0
            for p in parts[1:]:
                if re.fullmatch(r'[\d.]+\s*s(ec)?', p):
                    dur = float(re.sub(r'[^\d.]', '', p))
                elif re.fullmatch(r'[AB]\s*@\s*[\d.]+', p, re.I):
                    t, s = p.split('@')
                    src = {'track': t.strip().upper(), 'at': float(s)}
                elif p.startswith('@'):
                    at = float(p[1:].rstrip('s'))
            music.append({'mood': mood, 'dur': dur, 'src': src, 'at': at, 'raw': it})
            continue
        at = None
        m = re.search(r'@\s*([\d.]+)\s*s?\b', it)
        if m:
            at = float(m.group(1))
            it = (it[:m.start()] + it[m.end():]).strip()
        loop = bool(re.search(r'\(\s*loop\s*\)', it, re.I))
        stop = bool(re.search(r'\(\s*stop\s*\)', it, re.I))
        name = re.sub(r'\([^)]*\)', '', it).strip(' .').lower()
        if name:
            sfx.append({'name': name, 'loop': loop, 'stop': stop, 'at': at, 'raw': it})
    return sfx, music


def parse_voice(label: str, inner: str, text: str):
    tags = re.findall(r'\[[^\]]*\]', inner or '')
    rest = re.sub(r'\[[^\]]*\]', '', inner or '')
    names = [x.strip() for x in rest.split(',') if x.strip()]
    return {'kind': label.upper(), 'speaker': names[0].upper() if names else '', 'tags': tags, 'text': strip_quotes(text)}


def parse(script: Path, ch: Channel, lang: str):
    errors, warns = [], []
    doc = {'script': script.as_posix(), 'lang': lang, 'title': '', 'meta': {}, 'scenes': []}
    scene = shot = None
    field = None
    lines = script.read_text(encoding='utf-8').splitlines()
    for n, line in enumerate(lines, 1):
        s = line.strip()
        if not s or s.startswith('<!--') or s == '---':
            continue
        if s.startswith('# ') and not doc['title']:
            doc['title'] = s[2:].strip()
            m = re.search(r'EP\s*(\d+)\s*·?\s*CH\s*(\d+)', s, re.I)
            if m:
                doc['episode'], doc['chapter'] = int(m.group(1)), int(m.group(2))
            continue
        if s.lower().startswith('meta:'):
            doc['meta'] = kv(s[5:])
            continue
        m = RE_SCENE.match(s)
        if m:
            d = kv(m.group(3) or '')
            scene = {'id': m.group(1).zfill(2), 'title': (m.group(2) or '').strip(), 'location': d.get('location', ''),
                     'preset': d.get('preset', ''), 'time': d.get('time', ''), 'line': n, 'shots': []}
            pre_raw = scene['preset']
            scene['preset'] = ch.cfg.get('preset_aliases', {}).get(pre_raw, pre_raw)
            if scene['preset'] != pre_raw:
                scene['preset_raw'] = pre_raw
            loc, pre = scene['location'], scene['preset']
            if loc not in ch.cfg['locations']:
                errors.append(f'line {n}: SCENE {scene["id"]}: unknown location "{loc}". Known: {", ".join(ch.cfg["locations"])}. '
                              f'A new one — add it to {ch.id}/pipeline/channel.json → locations (kit: null — a stub)')
            if pre not in ch.cfg['presets']:
                errors.append(f'line {n}: SCENE {scene["id"]}: unknown preset "{pre}". Available: {", ".join(ch.cfg["presets"])} '
                              f'and aliases {", ".join(ch.cfg.get("preset_aliases", {}))}')
            doc['scenes'].append(scene)
            shot = field = None
            continue
        m = RE_SHOT.match(s)
        if m:
            if not scene:
                errors.append(f'line {n}: SHOT before the first SCENE')
                continue
            sid = f'{m.group(1).zfill(2)}.{m.group(2).zfill(2)}'
            d = kv(m.group(4) or '')
            dur = float(m.group(3).replace(',', '.')) if m.group(3) else 0.0
            if dur <= 0:
                errors.append(f'line {n}: SHOT {sid}: no duration ("| 5.0s |")')
            if m.group(1).zfill(2) != scene['id']:
                warns.append(f'line {n}: SHOT {sid} inside SCENE {scene["id"]}')
            shot = {'id': sid, 'planned': dur, 'camera': d.get('camera', ''), 'on_screen': '', 'text': [], 'lines': [], 'sfx': [],
                    'music': [], 'note': '', 'line': n}
            scene['shots'].append(shot)
            field = None
            continue
        m = RE_FIELD.match(s)
        if m and shot is not None:
            label, inner, body = m.group(1).upper(), m.group(2), m.group(3)
            if label in ('VO', 'DIALOGUE'):
                v = parse_voice(label, inner, body)
                v['line'] = n
                shot['lines'].append(v)
                field = ('line', v)
            elif label == 'ON SCREEN':
                shot['on_screen'] = (shot['on_screen'] + ' ' + body).strip()
                field = ('on_screen', None)
            elif label == 'TEXT':
                shot['text_raw'] = (shot.get('text_raw', '') + '; ' + body).strip('; ')
                field = ('text_raw', None)
            elif label == 'SFX':
                shot['sfx_raw'] = (shot.get('sfx_raw', '') + '; ' + body).strip('; ')
                field = ('sfx_raw', None)
            else:
                shot['note'] = (shot['note'] + ' ' + body).strip()
                field = ('note', None)
            continue
        if s.startswith('#'):
            if s.startswith('## '):  # another second-level section (notes for the review and so on) — the end of the scenes
                scene = shot = None
            field = None
            continue
        if field and shot is not None:  # continuation of a field on the next line
            k, v = field
            if k == 'line':
                v['text'] = strip_quotes(v['text'] + ' ' + s)
            elif k in ('text_raw', 'sfx_raw'):
                shot[k] = shot[k] + ' ' + s
            else:
                shot[k] = (shot[k] + ' ' + s).strip()
            continue
        if scene is None and doc['title']:
            continue  # introduction before the first scene
        warns.append(f'line {n}: cannot parse: {s[:80]}')

    ids = set()
    for sc in doc['scenes']:
        if not sc['shots']:
            errors.append(f'line {sc["line"]}: SCENE {sc["id"]} without shots')
        for sh in sc['shots']:
            if sh['id'] in ids:
                errors.append(f'line {sh["line"]}: SHOT {sh["id"]} is repeated')
            ids.add(sh['id'])
            sh['text'] = parse_text(sh.pop('text_raw', ''))
            sh['sfx'], sh['music'] = parse_sfx(sh.pop('sfx_raw', ''))
            for v in sh['lines']:
                if not v['text']:
                    errors.append(f'line {v["line"]}: SHOT {sh["id"]}: empty line')
                    continue
                r = ch.speaker(v['speaker'])
                if not r:
                    errors.append(f'line {v["line"]}: SHOT {sh["id"]}: unknown speaker "{v["speaker"]}". Available: '
                                  f'{", ".join(ch.voices["speakers"])} (and aliases). A new one — add it to {ch.id}/pipeline/voices.json')
                else:
                    v['voice'] = r[0]
                    if r[2]:  # voice copy: the original voice + processing by NOTE and tags
                        v['effect'] = ch.mimic_effect(sh['note'] + ' ' + ' '.join(v['tags']))
                        keys = [w for e in ch.voices['voice_suffix']['effects'].values() for w in e['keys']]
                        v['tags'] = [t for t in v['tags'] if not any(w in t.lower() for w in keys)]
                if lang == 'ko' and not has_hangul(v['text']):
                    errors.append(f'line {v["line"]}: SHOT {sh["id"]}: the line is not in Korean — translate the script into script.ko.md '
                                  f'(docs/PIPELINE.md, "Translation"): "{v["text"][:50]}"')
    if not doc['scenes']:
        errors.append('the script has no SCENE')
    vo = source_vo(script)  # VO of the English draft — for the "line → event" check (a list for the eye)
    for sc in doc['scenes']:
        for sh in sc['shots']:
            sh['vo_src'] = vo.get(sh['id'], []) if vo else [v['text'] for v in sh['lines'] if v['kind'] == 'VO']
    doc['warnings'] = warns
    if errors:
        raise PipelineError('the script did not pass the check:\n  ' + '\n  '.join(errors[:40]) + (f'\n  … {len(errors) - 40} more' if len(errors) > 40 else ''))
    return doc


def source_vo(script: Path) -> dict:
    """Narrator VO of the English draft script.md next to the translation script.<lang>.md: shot → [text without tags].
    For a translation without a draft pair and for the draft itself — {} (the script's own VO is used)."""
    src = script.with_name('script.md')
    if script.name == 'script.md' or not src.exists():
        return {}
    out, sid = {}, None
    for line in src.read_text(encoding='utf-8').splitlines():
        s = line.strip()
        m = RE_SHOT.match(s)
        if m:
            sid = f'{m.group(1).zfill(2)}.{m.group(2).zfill(2)}'
            continue
        m = RE_FIELD.match(s)
        if m and sid and m.group(1).upper() == 'VO':
            out.setdefault(sid, []).append(strip_quotes(re.sub(r'\[[^\]]*\]', '', m.group(3))).strip())
    return out


def pick_script(p: Path, lang: str) -> Path:
    if p.is_dir():
        p = p / 'script.md'
    alt = p.with_name(f'{p.stem}.{lang}.md')
    if p.name == 'script.md' and alt.exists():
        return alt
    if not p.exists():
        raise PipelineError(f'no script {p}')
    return p


if __name__ == '__main__':
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument('script')
    ap.add_argument('--lang')
    ap.add_argument('--out')
    a = ap.parse_args()
    try:
        chn = Channel(channel_dir(Path(a.script) / 'script.md' if Path(a.script).is_dir() else Path(a.script)))
        a.lang = a.lang or chn.lang
        sp = pick_script(Path(a.script), a.lang)
        d = parse(sp, chn, a.lang)
    except PipelineError as e:
        sys.exit(f'ERROR: {e}')
    if a.out:
        save_json(a.out, d)
    n = sum(len(s['shots']) for s in d['scenes'])
    print(f'{sp.name}: scenes {len(d["scenes"])}, shots {n}, lines {sum(len(sh["lines"]) for s in d["scenes"] for sh in s["shots"])}')
    for w in d['warnings']:
        print('  warning:', w)
