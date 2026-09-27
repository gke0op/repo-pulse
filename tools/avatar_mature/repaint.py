# repaint.py <char> <tops_in.png> <islands.json> <body_tex.png> <out.png>
# Rebuilds the Tops atlas: every island keeps its own fold shading (luminance, normalised per island)
# and takes a new cloth colour. Kai: plain shirt, open collar. Mira: knit V-neck top, skin in the V.
import sys, json
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage as nd

char, src, islp, bodyp, out = sys.argv[1:6]
im = np.asarray(Image.open(src).convert('RGBA')).astype(np.float32) / 255
H, W = im.shape[:2]
rgb, alpha = im[..., :3], im[..., 3:]
L = rgb @ np.array([0.2126, 0.7152, 0.0722], np.float32)
isl = json.load(open(islp))

def lab(i):
    if i['label'] == 'sleeve' and i['n'] <= 11:   # thin bands at u=.33/.67 are the collar's edges
        return 'collar'
    return i['label']

masks = {}
for i in isl:
    m = Image.new('L', (W, H), 0); d = ImageDraw.Draw(m)
    for p in i['polys']:
        d.polygon([(u * W, (1 - v) * H) for u, v in p], fill=255)
    k = lab(i)
    masks[k] = np.maximum(masks.get(k, np.zeros((H, W), np.uint8)), np.asarray(m))
masks = {k: nd.binary_dilation(v > 0, iterations=10) for k, v in masks.items()}
yy, xx = np.mgrid[0:H, 0:W]
U, V = xx / W, 1 - yy / H

def hexc(h): return np.array([int(h[i:i + 2], 16) / 255 for i in (1, 3, 5)], np.float32) ** 2.2
def lin(x): return x ** 2.2

def fill(S, bad):
    """Normalised-convolution inpaint of S where bad is True."""
    good = (~bad).astype(np.float32)
    num, den = nd.gaussian_filter(S * good, 18), nd.gaussian_filter(good, 18)
    return np.where(bad, num / np.maximum(den, 1e-4), S)

def shading(mask, lo=0.6, hi=1.2):
    Ll = lin(L)
    med = np.median(Ll[mask]) if mask.any() else 1
    return np.clip(Ll / med, lo, hi)

# skin tone: median of the bright skin in the body texture (linear)
body = np.asarray(Image.open(bodyp).convert('RGB')).astype(np.float32) / 255
bl = body.reshape(-1, 3); bl = bl[(bl.sum(1) > 1.8)]
skin = lin(np.median(bl, 0))

outl = lin(rgb.copy())
if char == 'kai':
    cloth = hexc('#4b5262')                       # dark slate shirt
    tm = masks['torso']
    tmed = np.median(lin(L)[tm])
    for k in ['torso', 'side', 'sleeve', 'collar', 'placket', 'other']:
        m = masks.get(k)
        if m is None: continue
        S = shading(m)
        if k == 'torso':                           # erase the vest's ribbed V-neck, its edge line and the hem
            box = (U > 0.36) & (U < 0.64) & (V > 0.40) & (V < 0.64)
            dev = np.abs(S - nd.median_filter(S, 41)) > 0.10
            hole = box & ~nd.binary_erosion(m, iterations=4)          # the V opening's rim, inside the island
            edge = box & m & nd.binary_dilation(hole, iterations=30)
            rib = m & ((box & (dev | (S < 0.85))) | edge | (V < 0.075))
            rib = nd.binary_dilation(rib, iterations=6) & m
            S = fill(nd.gaussian_filter(S, 1.5), rib)
        if k == 'placket':                         # same cloth brightness as the torso, soft folds only
            S = np.clip(nd.gaussian_filter(lin(L), 6) / np.median(lin(L)[m]), 0.85, 1.1) * 1.0
        outl[m] = (cloth * S[m, None])
    # open collar: skin in a V where the two fronts meet, two buttons undone
    pm = masks['placket']
    v0, v1, half = 0.585, 0.70, 0.05
    w = half * np.clip((V - v0) / (v1 - v0), 0, 1) ** 0.8
    open_ = pm & (V > v0) & (np.abs(U - 0.4995) < w + 0.003)
    edge = nd.binary_dilation(open_, iterations=6) & pm & ~open_
    outl[open_] = skin * 0.9
    outl[edge] = cloth * 0.6                       # the fold where the fronts turn back
elif char == 'mira':
    knit = hexc('#cbb49e')                        # warm oat knit
    rib = 0.965 + 0.035 * np.sin(xx * (2 * np.pi / 9.0))   # faint vertical knit ribs
    for k in ['torso', 'side', 'sleeve']:
        m = masks.get(k)
        if m is None: continue
        S = shading(m, 0.55, 1.15)
        outl[m] = knit * (S * rib)[m, None]
    # V-neck ribbing stays, a shade darker than the knit
    m = masks['torso']
    box = (U > 0.36) & (U < 0.64) & (V > 0.40) & (V < 0.64)
    S = shading(m)
    ribv = m & box & (S < 0.8)
    outl[ribv] = knit * 0.62 * np.clip(S[ribv, None] / 0.8, 0.5, 1)
    # skin shows in the V (the placket geometry stays; the collar is deleted in Blender)
    pm = masks['placket']
    Sp = shading(pm, 0.8, 1.1)
    outl[pm] = skin * (0.93 + 0.07 * (Sp[pm, None] - 0.95))
    cm = masks.get('collar')
    if cm is not None: outl[cm] = knit * 0.9       # harmless if collar geometry is removed

res = np.clip(outl, 0, 1) ** (1 / 2.2)
Image.fromarray((np.concatenate([res, alpha], 2) * 255 + 0.5).astype(np.uint8), 'RGBA').save(out)
print('wrote', out)
