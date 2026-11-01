# Erzeugt das ImmoAdv-Browser-Logo (ImmoAdv-Fade) in allen benötigten Größen.
# Aufruf: python3 scripts/make-logo.py
from PIL import Image, ImageDraw, ImageFilter
import os, math
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
S = 4096  # Arbeitsgröße (4x), am Ende auf 1024 verkleinert
k = S / 1024

def lerp(a, b, t): return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))
STOPS = [(0.0, (11, 31, 58)), (0.45, (42, 91, 215)), (0.95, (25, 194, 176)), (1.0, (25, 194, 176))]  # Navy → Blau → Teal
def fade(t):
    for (t0, c0), (t1, c1) in zip(STOPS, STOPS[1:]):
        if t <= t1: return lerp(c0, c1, (t - t0) / (t1 - t0))
    return STOPS[-1][1]

def gradient(size):
    g = Image.new('RGB', (size, size))
    px = g.load()
    for y in range(size):
        for x in range(size):
            t = (x * 0.55 + y * 0.45) / size     # diagonal von oben links nach unten rechts
            px[x, y] = fade(min(1, max(0, t)))
    return g

def squircle_mask(size, inset, radius):
    m = Image.new('L', (size, size), 0)
    ImageDraw.Draw(m).rounded_rectangle([inset, inset, size - inset, size - inset], radius=radius, fill=255)
    return m

def mark(draw, s, ox=0, oy=0, scale=1.0, img=None):
    """Weißes Zeichen: Dach über einer Weltkugel (Browser + Immobilie)."""
    f = lambda v: v * s * scale
    cx, cy, r, w = 512, 604, 196, 44
    # Längengrad + Äquator nur innerhalb der Kugel (eigene Ebene mit Maske)
    size = img.size[0]
    inner = Image.new('RGBA', img.size, (0, 0, 0, 0))
    d2 = ImageDraw.Draw(inner)
    rw = 84
    d2.ellipse([ox + f(cx - rw), oy + f(cy - r), ox + f(cx + rw), oy + f(cy + r)], outline=(255, 255, 255, 200), width=int(f(24)))
    d2.line([ox + f(cx - r), oy + f(cy), ox + f(cx + r), oy + f(cy)], fill=(255, 255, 255, 200), width=int(f(24)))
    m = Image.new('L', img.size, 0)
    ImageDraw.Draw(m).ellipse([ox + f(cx - r), oy + f(cy - r), ox + f(cx + r), oy + f(cy + r)], fill=255)
    a = inner.getchannel('A'); inner.putalpha(Image.composite(a, Image.new('L', img.size, 0), m))
    img.alpha_composite(inner)
    draw.ellipse([ox + f(cx - r), oy + f(cy - r), ox + f(cx + r), oy + f(cy + r)], outline='white', width=int(f(w)))
    # Dach
    pts = [(262, 440), (512, 236), (762, 440)]
    pts = [(ox + f(x), oy + f(y)) for x, y in pts]
    draw.line(pts, fill='white', width=int(f(54)), joint='curve')
    for x, y in pts:
        rr = f(27)
        draw.ellipse([x - rr, y - rr, x + rr, y + rr], fill='white')

def app_icon(size_out=1024, inset=100, radius=185):
    base = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    # weicher Schatten
    sh = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    ImageDraw.Draw(sh).rounded_rectangle([inset * k, (inset + 18) * k, S - inset * k, S - inset * k + 18 * k], radius=radius * k, fill=(0, 0, 0, 110))
    sh = sh.filter(ImageFilter.GaussianBlur(28 * k))
    base.alpha_composite(sh)
    g = gradient(512).resize((S, S), Image.BICUBIC).convert('RGBA')
    g.putalpha(squircle_mask(S, inset * k, radius * k))
    base.alpha_composite(g)
    layer = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    mark(ImageDraw.Draw(layer), k, 0, -20 * k, 1.0, layer)
    base.alpha_composite(layer)
    return base.resize((size_out, size_out), Image.LANCZOS)

def small_icon(px):
    """Kleine Größen: randlos (kein Schatten), damit das Zeichen groß genug bleibt."""
    s = 1024 * 4
    img = Image.new('RGBA', (s, s), (0, 0, 0, 0))
    g = gradient(256).resize((s, s), Image.BICUBIC).convert('RGBA')
    g.putalpha(squircle_mask(s, 0, 230 * 4))
    img.alpha_composite(g)
    layer = Image.new('RGBA', (s, s), (0, 0, 0, 0))
    # Zeichen etwas größer
    sc = 1.18
    off = -512 * 4 * (sc - 1)
    mark(ImageDraw.Draw(layer), 4, off, off - 60, sc, layer)
    img.alpha_composite(layer)
    return img.resize((px, px), Image.LANCZOS)

if __name__ == '__main__':
    os.makedirs(os.path.join(ROOT, 'build'), exist_ok=True)
    big = app_icon()
    big.save(os.path.join(ROOT, 'build', 'icon.png'))
    for d in ('extension/icons', 'theme'):
        os.makedirs(os.path.join(ROOT, d), exist_ok=True)
    for p in (16, 32, 48, 128):
        small_icon(p).save(os.path.join(ROOT, 'extension', 'icons', f'icon{p}.png'))
    small_icon(256).save(os.path.join(ROOT, 'src', 'ui', 'logo.png'))
    small_icon(128).save(os.path.join(ROOT, 'theme', 'icon128.png'))
    print('Logo erstellt.')
