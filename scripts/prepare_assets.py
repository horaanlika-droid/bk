"""Rebuild local brand/photo assets from the supplied originals.
Run from the repository root: python scripts/prepare_assets.py (requires Pillow).
No source image is modified. Fonts in assets/fonts are distributed under OFL.txt.
"""
from pathlib import Path
from PIL import Image

Path('assets').mkdir(exist_ok=True)
logo = Image.open('IMG_1298.png').convert('RGBA').crop((222, 190, 1265, 853))
pixels = logo.load()
for y in range(logo.height):
    for x in range(logo.width):
        r, g, b, _ = pixels[x, y]
        alpha = 255 - min(r, g, b)
        if alpha < 18:
            pixels[x, y] = (0, 0, 0, 0)
        else:
            rgb = tuple(max(0, round((v - 255 + alpha) * 255 / alpha)) for v in (r, g, b))
            pixels[x, y] = (*rgb, alpha)
logo.thumbnail((640, 420))
logo.save('assets/logo.png')
coin = Image.new('RGBA', logo.size, (49, 30, 0, 0))
coin.putalpha(logo.getchannel('A'))
coin.save('assets/coin-mark.png')
Image.open('IMG_1283.webp').save('assets/cafe.webp', quality=85)
photos = [
    ('latte', 'IMG_1289.jpeg', (120, 370, 830, 1080)),
    ('cappuccino', 'IMG_1282.webp', (20, 100, 430, 510)),
    ('raf', 'IMG_1292.jpeg', (140, 450, 780, 1090)),
    ('ice-latte', 'IMG_1291.jpeg', (130, 400, 800, 1070)),
    ('lemonade', 'IMG_1290.jpeg', (100, 400, 790, 1090)),
]
for name, source, box in photos:
    Image.open(source).crop(box).resize((480, 480)).save(f'assets/{name}.webp', quality=85)
