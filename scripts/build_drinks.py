"""Temporary colour variants of the cold-drink illustration.

Recolours the liquid inside art-src/iced-matcha.webp so lemonades get a
drawing of the right colour until dedicated illustrations are generated.
Run from the repository root: python scripts/tint_drinks.py (Pillow + numpy).
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter
import numpy as np

SRC = Path("art-src/iced-matcha.webp")
VARIANTS = {
    "lemonade-yellow": (246, 206, 60),
    "lemonade-pink": (238, 120, 160),
    "lemonade-red": (205, 45, 70),
    "lemonade-orange": (245, 140, 45),
    "lemonade-blue": (70, 160, 220),
    "lemonade-purple": (150, 100, 200),
    "lemonade-green": (110, 185, 80),
}

base = Image.open(SRC).convert("RGB")
w, h = base.size
sx, sy = w / 1024, h / 1024
poly = [(328 * sx, 405 * sy), (704 * sx, 405 * sy), (657 * sx, 884 * sy), (373 * sx, 884 * sy)]
mask_img = Image.new("L", base.size, 0)
ImageDraw.Draw(mask_img).polygon(poly, fill=255)
region = np.array(mask_img) > 0

rgb = np.array(base).astype(float)
hsv = np.array(base.convert("HSV")).astype(float)
hue, sat, val = hsv[..., 0], hsv[..., 1], hsv[..., 2]
rows = np.arange(h)[:, None].repeat(w, axis=1)
yellow = (hue > 25) & (hue < 50) & (sat > 110)  # straw and logo accents
dark = val < 95  # ink outlines and the logo letter
green = (hue > 45) & (hue < 125) & (sat > 30) & (rows > 395 * sy)
cream = region & (rows > 440 * sy) & (sat < 90) & (val > 150)
liquid = (green | cream) & ~yellow & ~dark
soft = np.array(
    Image.fromarray((liquid * 255).astype("uint8")).filter(ImageFilter.GaussianBlur(2 * sx))
).astype(float)[..., None] / 255
soft = np.where((yellow | dark)[..., None], 0, soft)
top, bottom = 410 * sy, 884 * sy
t = np.clip((rows - top) / (bottom - top), 0, 1)
strength = (0.9 - 0.35 * t)[..., None]  # saturated at the top, lighter below
# Brightness relative to the local liquid tone keeps the watercolour grain but
# removes the dark matcha shading, so e.g. yellow does not turn olive.
ref = np.median(val[liquid])
light = np.clip(0.95 + 0.3 * (val - ref) / 255, 0.8, 1.1)[..., None]

for name, colour in VARIANTS.items():
    tinted = np.array(colour, float)[None, None, :] * light
    mixed = rgb * (1 - strength) + tinted * strength
    out = rgb * (1 - soft) + mixed * soft
    Image.fromarray(np.clip(out, 0, 255).astype("uint8")).save(f"art-src/{name}.webp", quality=92, method=6)
    print("wrote", name)

Path("assets/drinks").mkdir(parents=True, exist_ok=True)
for source in sorted(Path("art-src").glob("*.webp")):
    Image.open(source).convert("RGB").crop((60, 60, 964, 964)).resize((640, 640), Image.LANCZOS).save(
        f"assets/drinks/{source.stem}.webp", quality=84, method=6
    )
print("exported", len(list(Path("assets/drinks").glob("*.webp"))), "drawings")
