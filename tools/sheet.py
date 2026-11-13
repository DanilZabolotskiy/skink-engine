"""Frame sheets: frames in a grid (2 columns by default) at full resolution, a caption under each; the font of all sheets.

python tools/sheet.py out.jpg "Title" frame.png=caption ... [--cols 3 --w 1280]
A 1:1 piece of a frame — "frame.png@x,y,w,h=caption" (all pieces have the same size w×h).
--cols — columns (default 2), --w — cell width (the frame is scaled proportionally; default — as is).
"""
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

FONT = Path(__file__).resolve().parents[1] / 'public' / 'fonts' / 'NotoSansKR.ttf'


def font(size: int, bold: bool = True):
    """The project font (public/fonts/NotoSansKR.ttf, a variable font) at the bold or regular weight; without it — Pillow's default."""
    try:
        f = ImageFont.truetype(str(FONT), size)
    except OSError:
        return ImageFont.load_default(size)
    try:
        f.set_variation_by_name('Bold' if bold else 'Regular')
    except OSError:
        pass  # FreeType without variation support: the default instance of the font
    return f


def make_sheet(out, title: str, items: list, cols: int = 2, cw: int | None = None):
    """items: [(frame path, crop box (x0, y0, x1, y1) or None, caption)] → a JPEG sheet."""
    first, box0 = Image.open(items[0][0]), items[0][1]
    w, h = (box0[2] - box0[0], box0[3] - box0[1]) if box0 else first.size
    if cw:
        w, h = cw, round(h * cw / w)
    bar, top = 56, 80
    rows = (len(items) + cols - 1) // cols
    sheet = Image.new('RGB', (cols * w, top + rows * (h + bar)), (14, 16, 26))
    d = ImageDraw.Draw(sheet)
    f1, f2 = font(44 if w >= 1500 else 30), font(36 if w >= 1500 else 26, bold=False)
    d.text((24, 14), title, fill=(235, 238, 245), font=f1)
    for k, (path, box, label) in enumerate(items):
        x = (k % cols) * w
        y = top + (k // cols) * (h + bar)
        img = Image.open(path).convert('RGB')
        if box:
            img = img.crop(box)
        if img.size != (w, h):
            img = img.resize((w, h), Image.LANCZOS)
        sheet.paste(img, (x, y))
        d.text((x + 20, y + h + 8), label, fill=(255, 190, 90), font=f2)
    sheet.save(out, quality=95)
    return out


def main(argv: list):
    cols, cw = 2, None
    if '--cols' in argv:
        i = argv.index('--cols')
        cols = int(argv[i + 1])
        del argv[i:i + 2]
    if '--w' in argv:
        i = argv.index('--w')
        cw = int(argv[i + 1])
        del argv[i:i + 2]
    out, title, *specs = argv
    items = []
    for it in specs:
        path, label = it.split('=', 1)
        box = None
        if '@' in path:
            path, b = path.split('@', 1)
            x, y, w, h = map(int, b.split(','))
            box = (x, y, x + w, y + h)
        items.append((path, box, label))
    make_sheet(out, title, items, cols, cw)


if __name__ == '__main__':
    main(sys.argv[1:])
