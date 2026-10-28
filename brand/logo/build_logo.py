"""Build the Narwi logo set (mark A2 + outlined wordmarks) as SVG files.

Usage: python build_logo.py <Amiri-Bold.ttf> <Fraunces-variable.ttf> <out_dir>
"""
import os
import sys

from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

AMIRI, FRAUNCES_VF, OUT = sys.argv[1:4]
os.makedirs(OUT, exist_ok=True)

LIGHT = {"mark": "#1E3A8A", "dot": "#B4322A", "text": "#161A2B"}
DARK = {"mark": "#8DA6F2", "dot": "#EE7B66", "text": "#ECE9E1"}
MONO_BLACK = {"mark": "#000000", "dot": "#000000", "text": "#000000"}
MONO_WHITE = {"mark": "#FFFFFF", "dot": "#FFFFFF", "text": "#FFFFFF"}

# Mark A2 in a 100-unit box (same geometry as logo.html #nun2).
BOWL = "M12 40 C12 72 30 88 50 88 C72 88 90 70 88 34 L76 38 C77 60 66 72 50 72 C36 72 25 60 25 38 Z"
DOT = [(50, 15), (61, 26), (50, 37), (39, 26)]
MARK_BOX = (12, 15, 90, 88)  # x0, y0, x1, y1 of the drawn shapes


def mark_svg(x, y, h, c):
    """Mark scaled so its drawn height is h, top-left of drawn box at (x, y)."""
    s = h / (MARK_BOX[3] - MARK_BOX[1])
    tx, ty = x - MARK_BOX[0] * s, y - MARK_BOX[1] * s
    pts = " ".join(f"{px},{py}" for px, py in DOT)
    return (f'<g transform="translate({tx:.2f} {ty:.2f}) scale({s:.4f})">'
            f'<path d="{BOWL}" fill="{c["mark"]}"/><polygon points="{pts}" fill="{c["dot"]}"/></g>')


def mark_width(h):
    return (MARK_BOX[2] - MARK_BOX[0]) * h / (MARK_BOX[3] - MARK_BOX[1])


class Run:
    """A run of glyphs drawn left to right, outlined to one SVG path."""

    def __init__(self, font, glyphs, size):
        self.font, self.glyphs = font, glyphs
        self.scale = size / font["head"].unitsPerEm
        gs = font.getGlyphSet()
        bp = BoundsPen(gs)
        x = 0
        for g in glyphs:
            gs[g].draw(TransformPen(bp, (self.scale, 0, 0, -self.scale, x, 0)))
            x += gs[g].width * self.scale
        self.bounds = bp.bounds  # xmin, ymin, xmax, ymax in y-down space, baseline at 0

    def path(self, ox, oy):
        """Path with the run's bounding box top-left placed at (ox, oy)."""
        gs = self.font.getGlyphSet()
        sp = SVGPathPen(gs)
        x = ox - self.bounds[0]
        base = oy - self.bounds[1]
        for g in self.glyphs:
            gs[g].draw(TransformPen(sp, (self.scale, 0, 0, -self.scale, x, base)))
            x += gs[g].width * self.scale
        return sp.getCommands()

    @property
    def w(self):
        return self.bounds[2] - self.bounds[0]

    @property
    def h(self):
        return self.bounds[3] - self.bounds[1]


amiri = TTFont(AMIRI)
fraunces = instancer.instantiateVariableFont(TTFont(FRAUNCES_VF), {"wght": 600, "opsz": 72, "SOFT": 0, "WONK": 0})

# نروي in visual (left-to-right) order: yeh isolated, waw isolated, reh final, noon initial.
cm_a = amiri.getBestCmap()
AR = Run(amiri, [cm_a[c] for c in (0xFEF1, 0xFEED, 0xFEAE, 0xFEE7)], 200)
cm_l = fraunces.getBestCmap()
LAT = Run(fraunces, [cm_l[ord(ch)] for ch in "Narwi"], 160)


def svg(w, h, body, pad):
    W, H = w + 2 * pad, h + 2 * pad
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W:.0f} {H:.0f}" width="{W:.0f}" height="{H:.0f}">'
            f'<g transform="translate({pad} {pad})">{body}</g></svg>\n')


def write(name, content):
    with open(os.path.join(OUT, name), "w", encoding="utf-8") as fh:
        fh.write(content)


def lockup_ar(c):
    # RTL reading: mark on the right, نروي to its left.
    mh = AR.h * 0.78
    gap = mh * 0.3
    mw = mark_width(mh)
    w = AR.w + gap + mw
    body = (f'<path d="{AR.path(0, 0)}" fill="{c["text"]}"/>'
            + mark_svg(AR.w + gap, (AR.h - mh) / 2 - AR.h * 0.08, mh, c))
    return svg(w, AR.h, body, 24)


def lockup_en(c):
    mh = LAT.h * 1.35
    gap = mh * 0.3
    mw = mark_width(mh)
    h = max(mh, LAT.h)
    body = mark_svg(0, (h - mh) / 2, mh, c) + f'<path d="{LAT.path(mw + gap, (h - LAT.h) / 2)}" fill="{c["text"]}"/>'
    return svg(mw + gap + LAT.w, h, body, 24)


def lockup_stacked(c):
    mh = AR.h * 0.9
    mw = mark_width(mh)
    lat_scale = 0.55
    lw, lh = LAT.w * lat_scale, LAT.h * lat_scale
    w = max(mw, AR.w, lw)
    gap = mh * 0.18
    y_ar = mh + gap
    y_lat = y_ar + AR.h + gap * 0.8
    body = (mark_svg((w - mw) / 2, 0, mh, c)
            + f'<path d="{AR.path((w - AR.w) / 2, y_ar)}" fill="{c["text"]}"/>'
            + f'<g transform="translate({(w - lw) / 2:.2f} {y_lat:.2f}) scale({lat_scale})">'
            + f'<path d="{LAT.path(0, 0)}" fill="{c["text"]}"/></g>')
    return svg(w, y_lat + lh, body, 24)


def mark_only(c, size=512):
    h = size * 0.8
    mw = mark_width(h)
    return svg(mw, h, mark_svg(0, 0, h, c), size * 0.1)


def wordmark(run, c):
    return svg(run.w, run.h, f'<path d="{run.path(0, 0)}" fill="{c["text"]}"/>', 16)


def app_icon(size=1024):
    r = size * 0.225
    mh = size * 0.56
    mw = mark_width(mh)
    c = {"mark": "#FFFFFF", "dot": "#EE7B66"}
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {size} {size}" width="{size}" height="{size}">'
            f'<rect width="{size}" height="{size}" rx="{r}" fill="#1E3A8A"/>'
            + mark_svg((size - mw) / 2, (size - mh) / 2, mh, c) + '</svg>\n')


variants = {"": LIGHT, "-dark": DARK, "-black": MONO_BLACK, "-white": MONO_WHITE}
for suffix, c in variants.items():
    write(f"narwi-mark{suffix}.svg", mark_only(c))
    write(f"narwi-lockup-ar{suffix}.svg", lockup_ar(c))
    write(f"narwi-lockup-en{suffix}.svg", lockup_en(c))
    write(f"narwi-lockup-stacked{suffix}.svg", lockup_stacked(c))
    write(f"narwi-wordmark-ar{suffix}.svg", wordmark(AR, c))
    write(f"narwi-wordmark-en{suffix}.svg", wordmark(LAT, c))
write("narwi-app-icon.svg", app_icon())
write("favicon.svg", mark_only(LIGHT, 64))
print("written:", sorted(os.listdir(OUT)))
