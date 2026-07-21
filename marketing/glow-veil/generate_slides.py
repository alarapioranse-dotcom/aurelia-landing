#!/usr/bin/env python3
"""Generate the 4 TikTok launch slides (1080x1920 PNG) for Aurelia "Glow Veil".

Arabic is rendered by passing raw strings to PIL with direction="rtl",
language="ar" — requires Pillow built with libraqm (no arabic_reshaper).
Fonts are downloaded from the Google Fonts GitHub repo on first run.
"""

import os
import urllib.request

from PIL import Image, ImageDraw, ImageFont, features

assert features.check("raqm"), "Pillow lacks libraqm; Arabic shaping unavailable"

HERE = os.path.dirname(os.path.abspath(__file__))
FONT_DIR = os.path.join(HERE, "fonts")

W, H = 1080, 1920
BG = "#0A0A0A"
GOLD = "#D4AF37"
IVORY = "#F3EDDE"

FONTS = {
    "garamond": "https://raw.githubusercontent.com/google/fonts/main/ofl/ebgaramond/EBGaramond%5Bwght%5D.ttf",
    "cairo": "https://raw.githubusercontent.com/google/fonts/main/ofl/cairo/Cairo%5Bslnt,wght%5D.ttf",
    "amiri": "https://raw.githubusercontent.com/google/fonts/main/ofl/amiri/Amiri-Regular.ttf",
}


def fetch_fonts():
    os.makedirs(FONT_DIR, exist_ok=True)
    paths = {}
    for name, url in FONTS.items():
        path = os.path.join(FONT_DIR, name + ".ttf")
        if not os.path.exists(path):
            urllib.request.urlretrieve(url, path)
        paths[name] = path
    return paths


FONT_PATHS = fetch_fonts()


def garamond_bold(size):
    f = ImageFont.truetype(FONT_PATHS["garamond"], size)
    f.set_variation_by_axes([700])  # wght
    return f


def cairo_bold(size):
    f = ImageFont.truetype(FONT_PATHS["cairo"], size)
    f.set_variation_by_name("Bold")
    return f


def amiri(size):
    return ImageFont.truetype(FONT_PATHS["amiri"], size)


AR = {"direction": "rtl", "language": "ar"}


def new_slide():
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)
    # thin double gold border frame: 20px margin, 3px lines, 12px gap
    for inset in (20, 20 + 3 + 12):
        d.rectangle([inset, inset, W - 1 - inset, H - 1 - inset], outline=GOLD, width=3)
    draw_wordmark(d)
    return img, d


def draw_wordmark(d, y=110, size=64, tracking=30):
    font = garamond_bold(size)
    letters = "AURELIA"
    widths = [d.textlength(c, font=font) for c in letters]
    total = sum(widths) + tracking * (len(letters) - 1)
    x = (W - total) / 2
    for c, w in zip(letters, widths):
        d.text((x, y), c, font=font, fill=GOLD)
        x += w + tracking


def fit(d, text, maker, size, max_width, **kw):
    """Largest font (starting at `size`) whose rendering fits max_width."""
    while size > 20:
        font = maker(size)
        if d.textlength(text, font=font, **kw) <= max_width:
            return font
        size -= 2
    return maker(size)


def ar_center(d, text, maker, size, y, fill, max_width=920):
    font = fit(d, text, maker, size, max_width, **AR)
    d.text((W / 2, y), text, font=font, fill=fill, anchor="mm", **AR)
    return font


def sparkle(d, cx, cy, r, fill=GOLD):
    """Four-pointed star (stands in for the sparkle emoji, which the
    Arabic fonts have no glyph for)."""
    q = r * 0.22
    pts = [
        (cx, cy - r), (cx + q, cy - q), (cx + r, cy), (cx + q, cy + q),
        (cx, cy + r), (cx - q, cy + q), (cx - r, cy), (cx - q, cy - q),
    ]
    d.polygon(pts, fill=fill)
    d.polygon(
        [(cx + r * 0.62, cy - r * 0.85), (cx + r * 0.72, cy - r * 0.62),
         (cx + r * 0.95, cy - r * 0.52), (cx + r * 0.72, cy - r * 0.42),
         (cx + r * 0.62, cy - r * 0.19), (cx + r * 0.52, cy - r * 0.42),
         (cx + r * 0.29, cy - r * 0.52), (cx + r * 0.52, cy - r * 0.62)],
        fill=fill,
    )


def slide1():
    img, d = new_slide()
    ar_center(d, "واقية شمس... ولا مكياج؟", cairo_bold, 92, 880, IVORY)
    text = "الاثنان معاً"
    font = fit(d, text, cairo_bold, 68, 760, **AR)
    tw = d.textlength(text, font=font, **AR)
    d.text((W / 2, 1050), text, font=font, fill=GOLD, anchor="mm", **AR)
    sparkle(d, W / 2 - tw / 2 - 55, 1050, 30)
    img.save(os.path.join(HERE, "slide-1-hook.png"))


def slide2():
    # center 700px (y 610-1310) left empty for the product photo overlay
    img, d = new_slide()
    # LRM after the plus signs keeps them attached to the Latin run under bidi
    ar_center(d, "حماية SPF 50 PA++++‎", cairo_bold, 74, 440, IVORY)
    ar_center(d, "تغطية ملوّنة توحّد البشرة", cairo_bold, 64, 1450, IVORY)
    ar_center(d, "ملمس حريري خفيف", amiri, 58, 1580, GOLD)
    img.save(os.path.join(HERE, "slide-2-benefits.png"))


def slide3():
    img, d = new_slide()
    ar_center(d, "بدون أثر أبيض. بدون ثقل.", cairo_bold, 88, 880, IVORY)
    ar_center(d, "إشراقة فورية تليق بإطلالتك", amiri, 60, 1030, GOLD)
    img.save(os.path.join(HERE, "slide-3-texture.png"))


def slide4():
    img, d = new_slide()
    name = "Aurelia Glow Veil"
    font = fit(d, name, garamond_bold, 96, 920)
    d.text((W / 2, 720), name, font=font, fill=IVORY, anchor="mm")
    ar_center(d, "$24.99 — شحن مجاني عالمياً", cairo_bold, 56, 880, IVORY)

    code = "كود WELCOME15 — خصم 15%"
    cfont = fit(d, code, cairo_bold, 50, 800, **AR)
    tw = d.textlength(code, font=cfont, **AR)
    pad_x, pad_y, cy = 48, 30, 1080
    box_h = cfont.size + 2 * pad_y
    d.rounded_rectangle(
        [W / 2 - tw / 2 - pad_x, cy - box_h / 2, W / 2 + tw / 2 + pad_x, cy + box_h / 2],
        radius=14, fill=GOLD,
    )
    d.text((W / 2, cy), code, font=cfont, fill=BG, anchor="mm", **AR)

    ar_center(d, "الرابط في البايو", amiri, 56, 1650, GOLD)
    img.save(os.path.join(HERE, "slide-4-cta.png"))


if __name__ == "__main__":
    slide1()
    slide2()
    slide3()
    slide4()
    print("4 slides written to", HERE)
