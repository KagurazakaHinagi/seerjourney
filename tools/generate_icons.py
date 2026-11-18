#!/usr/bin/env python3
"""Render SeerJourney's Sea and Sky sigil from shared vector geometry.

Requires Pillow. The same curves generate the editable SVG and all PNG sizes.
The eye is a horizon, the long star point is north, and the wave is the sea.
"""
from pathlib import Path
from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parents[1] / 'assets' / 'icons'
OUT.mkdir(parents=True, exist_ok=True)
SIZE = 1024
SCALE = SIZE / 256
INK = '#216d51'
PEARL = '#f5efdb'
BRASS = '#e7bd6a'
SEA_GLASS = '#a8cec2'
STAR = [(128, 44), (140, 110), (169, 124), (140, 138),
        (128, 150), (116, 138), (87, 124), (116, 110)]
EYE = [
    [(40, 128), (62, 100), (86, 85), (108, 82)],
    [(148, 82), (170, 85), (194, 100), (216, 128)],
    [(40, 128), (86, 178), (170, 178), (216, 128)],
]
WAVE = [
    [(72, 196), (91, 182), (109, 210), (128, 196)],
    [(128, 196), (147, 182), (165, 182), (184, 196)],
]


def curve_path(curves):
    parts = []
    for curve in curves:
        a, b, c, d = curve
        parts.append(f'M{a[0]} {a[1]}C{b[0]} {b[1]} {c[0]} {c[1]} {d[0]} {d[1]}')
    return ''.join(parts)


def svg_mark(eye, star, sea):
    points = ' '.join(f'{x},{y}' for x, y in STAR)
    return (f'  <path d="{curve_path(EYE)}" fill="none" stroke="{eye}" stroke-width="12" stroke-linecap="round"/>\n'
            f'  <polygon points="{points}" fill="{star}"/>\n'
            f'  <path d="{curve_path(WAVE)}" fill="none" stroke="{sea}" stroke-width="10" stroke-linecap="round"/>\n')


# Editable, transparent single-color identity mark for the application chrome.
(OUT / 'seer-mark.svg').write_text(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">\n'
    + svg_mark(INK, INK, INK) + '</svg>\n')
# A self-contained vector app icon; PNGs use a square opaque ground for OS masking.
(OUT / 'icon.svg').write_text(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">\n'
    '  <defs><linearGradient id="ocean" x1="0" y1="0" x2="1" y2="1">'
    '<stop stop-color="#285f5d"/><stop offset="1" stop-color="#103b3e"/>'
    '</linearGradient></defs>\n'
    '  <rect width="256" height="256" rx="55" fill="url(#ocean)"/>\n'
    + svg_mark(PEARL, BRASS, SEA_GLASS) + '</svg>\n')

im = Image.new('RGB', (SIZE, SIZE))
pixels = im.load()
for y in range(SIZE):
    for x in range(SIZE):
        t = (x + y) / (2 * (SIZE - 1))
        pixels[x, y] = tuple(round(a + (b - a) * t) for a, b in zip((40, 95, 93), (16, 59, 62)))
draw = ImageDraw.Draw(im)


def scaled(point):
    return tuple(round(v * SCALE) for v in point)


def stroke(target, curves, color, width):
    line_width = round(width * SCALE)
    radius = line_width / 2
    for curve in curves:
        points = []
        for step in range(161):
            t = step / 160
            u = 1 - t
            points.append(scaled(tuple(u**3 * curve[0][axis] + 3*u*u*t * curve[1][axis]
                                      + 3*u*t*t * curve[2][axis] + t**3 * curve[3][axis]
                                      for axis in (0, 1))))
        target.line(points, fill=color, width=line_width, joint='curve')
        for x, y in (points[0], points[-1]):
            target.ellipse((x-radius, y-radius, x+radius, y+radius), fill=color)


stroke(draw, EYE, PEARL, 12)
draw.polygon([scaled(p) for p in STAR], fill=BRASS)
stroke(draw, WAVE, SEA_GLASS, 10)
for name, size in [('apple-touch-icon.png', 180), ('icon-192.png', 192),
                   ('icon-512.png', 512), ('icon-maskable-512.png', 512)]:
    im.resize((size, size), Image.Resampling.LANCZOS).save(OUT / name, optimize=True)
mark = Image.new('RGBA', (SIZE, SIZE))
mark_draw = ImageDraw.Draw(mark)
stroke(mark_draw, EYE, INK, 12)
mark_draw.polygon([scaled(p) for p in STAR], fill=INK)
stroke(mark_draw, WAVE, INK, 10)
mark.resize((512, 512), Image.Resampling.LANCZOS).save(OUT / 'seer-mark.png', optimize=True)
print('Rendered Sea and Sky SVGs, transparent mark, and opaque 180, 192, and 512 px app icons.')
