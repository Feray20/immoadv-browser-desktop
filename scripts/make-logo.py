# ImmoAdv Browser – Logo aus dem echten ImmoAdv-Zeichen (Polygone aus immoadv-icon.svg) + Kompass-Ring
import math, sys
from PIL import Image, ImageDraw, ImageFilter
S = 4; N = 1024 * S
POLYS = [
 [(50,8.3),(63.1,19.4),(62.6,22.5),(49,34),(45.2,31.1),(5.3,68.9),(2.5,70),(3.1,51.7)],
 [(98.8,0.7),(93.4,37.3),(83.6,29.8),(50.8,62.3),(43.7,57.9),(17.2,82.6),(0.2,82.6),(42.2,38.4),(50.3,40.1),(69.6,19.5),(64.6,8.1)],
 [(82.3,37.6),(99.5,53.6),(99.6,84),(88.6,83.6),(62.5,57)]]

def lerp(a,b,t): return tuple(int(a[i]+(b[i]-a[i])*t) for i in range(3))
def background(size):
    # wie das ImmoAdv-App-Symbol: Navy unten links → Blau → Hellblau oben rechts, mit sanftem Lichtpunkt
    g = Image.new('RGB', (256,256)); px = g.load()
    c0, c1, c2 = (12,32,72), (8,104,168), (60,190,245)
    for y in range(256):
        for x in range(256):
            t = (x*0.55 + (255-y)*0.45)/255
            px[x,y] = lerp(c0,c1,t/0.6) if t < 0.6 else lerp(c1,c2,(t-0.6)/0.4)
    g = g.resize((size,size), Image.BICUBIC).convert('RGBA')
    glow = Image.new('RGBA',(size,size),(0,0,0,0)); d = ImageDraw.Draw(glow)
    d.ellipse([size*0.55,size*0.05,size*0.95,size*0.45], fill=(255,255,255,55))
    g.alpha_composite(glow.filter(ImageFilter.GaussianBlur(size*0.08)))
    return g

def mark_layer(cx, cy, width):
    lay = Image.new('RGBA',(N,N),(0,0,0,0)); d = ImageDraw.Draw(lay)
    k = width/100*S; ox = cx*S - 50*k; oy = cy*S - 42.3*k
    for p in POLYS: d.polygon([(ox+x*k, oy+y*k) for x,y in p], fill=(240,247,253,255))
    return lay

def ring_layer(cx, cy, r, w):
    lay = Image.new('RGBA',(N,N),(0,0,0,0)); d = ImageDraw.Draw(lay)
    d.ellipse([(cx-r)*S,(cy-r)*S,(cx+r)*S,(cy+r)*S], outline=(240,247,253,255), width=int(w*S))
    for ang in (0,90,180,270):
        a = math.radians(ang); r1, r2 = r-w*0.4, r-w*2.6
        d.line([(cx+r1*math.sin(a))*S,(cy-r1*math.cos(a))*S,(cx+r2*math.sin(a))*S,(cy-r2*math.cos(a))*S], fill=(240,247,253,255), width=int(w*0.85*S))
    return lay

def shadowed(base, lay, blur, dy):
    a = lay.getchannel('A')
    sh = Image.new('RGBA', lay.size, (2,18,48,0)); sh.putalpha(a.point(lambda v: int(v*0.45)))
    sh = sh.filter(ImageFilter.GaussianBlur(blur*S))
    base.alpha_composite(sh, (0, int(dy*S))); base.alpha_composite(lay)

def make(full=True):
    if full:
        img = background(N)
        cx, cy, r, w, mw = 512, 512, 430, 24, 520
    else:
        img = Image.new('RGBA',(N,N),(0,0,0,0))
        bg = background(832*S); m = Image.new('L',(832*S,832*S),0)
        ImageDraw.Draw(m).rounded_rectangle([0,0,832*S,832*S], radius=185*S, fill=255)
        bg.putalpha(m)
        sh = Image.new('RGBA',(N,N),(0,0,0,0)); ImageDraw.Draw(sh).rounded_rectangle([96*S,(96+14)*S,928*S,(928+14)*S], radius=185*S, fill=(0,0,0,120))
        img.alpha_composite(sh.filter(ImageFilter.GaussianBlur(26*S)))
        img.alpha_composite(bg, (96*S, 96*S))
        cx, cy, r, w, mw = 512, 512, 350, 20, 425
    shadowed(img, ring_layer(cx, cy, r, w), 6, 3)
    shadowed(img, mark_layer(cx, cy+6, mw), 9, 6)
    return img.resize((1024,1024), Image.LANCZOS)

if __name__ == "__main__" and len(sys.argv) == 3:
    make(True).convert('RGB').save(sys.argv[1])
    make(False).save(sys.argv[2])


def make_square():
    # randlos wie die anderen Windows-Programm-Symbole (z. B. Claude, ImmoAdv Admin): abgerundetes Quadrat, füllt die Fläche
    img = make(True)
    m = Image.new('L', (1024*S, 1024*S), 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, 1024*S, 1024*S], radius=225*S, fill=255)
    img.putalpha(m.resize((1024, 1024), Image.LANCZOS))
    return img

def write_all(root):
    """Programm-Symbol (Windows/Mac) und Zeichen in der Oberfläche."""
    import os
    desk = make(False)
    desk.save(os.path.join(root, 'build', 'icon.png'))              # Mac (Apple-Raster mit Rand)
    make_square().save(os.path.join(root, 'build', 'icon-win.png'))  # Windows: randlos
    inner = desk.crop((96, 96, 928, 928))          # Symbol ohne Rand/Schatten für kleine Größen
    inner.resize((256, 256), Image.LANCZOS).save(os.path.join(root, 'src', 'renderer', 'emblem.png'))
    return make(True), inner

if __name__ == '__main__' and len(sys.argv) == 1:
    import os
    write_all(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    print('Logo erstellt.')
