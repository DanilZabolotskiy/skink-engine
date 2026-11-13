"""A coordinate grid over a frame, to read positions off it (placing figures and props in a kit).

python tools/grid.py <frame.png> <out.png> [step]   — lines every step px (default 100), every 500 px in magenta, labelled in px
"""
import sys
from pathlib import Path

from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from tools.sheet import font  # noqa: E402

src, dst = sys.argv[1], sys.argv[2]
step = int(sys.argv[3]) if len(sys.argv) > 3 else 100
im = Image.open(src).convert('RGB')
d = ImageDraw.Draw(im)
f = font(18, bold=False)
for x in range(0, im.width, step):
    d.line([(x, 0), (x, im.height)], fill=(255, 0, 255) if x % 500 == 0 else (255, 255, 0), width=1)
    d.text((x + 2, 2), str(x), fill=(255, 255, 255), font=f)
for y in range(0, im.height, step):
    d.line([(0, y), (im.width, y)], fill=(255, 0, 255) if y % 500 == 0 else (255, 255, 0), width=1)
    d.text((2, y + 2), str(y), fill=(255, 255, 255), font=f)
im.save(dst)
