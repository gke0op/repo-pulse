# eye_layers.py <iris.png> <out_dir>: split Mira's original iris into three stacked layers that composite
# back to the original: base (pupil and lower light spectrum painted out), glow (the lower light
# spectrum, original colours, soft alpha), pupil (original pupil, soft alpha). Same UV layout as the iris.
import sys, os, json
import numpy as np
from PIL import Image
from scipy import ndimage as nd

src, outd = sys.argv[1:3]
os.makedirs(outd, exist_ok=True)
a = np.asarray(Image.open(src).convert('RGBA')).astype(np.float32) / 255
H, W = a.shape[:2]; rgb, al = a[..., :3], a[..., 3]
yy, xx = np.mgrid[0:H, 0:W]
op = al > 0.5
lum = rgb @ np.array([0.2126, 0.7152, 0.0722], np.float32)


def fill(img, bad, sigma=14):
    good = (~bad & op).astype(np.float32); out = img.copy()
    for c in range(img.shape[-1]):
        num, den = nd.gaussian_filter(img[..., c] * good, sigma), nd.gaussian_filter(good, sigma)
        out[..., c] = np.where(bad, num / np.maximum(den, 1e-4), img[..., c])
    return out


pupil_m = np.zeros((H, W), bool); glow_m = np.zeros((H, W), np.float32); info = {}
for side, half in (('left', xx < W / 2), ('right', xx >= W / 2)):
    m = op & half
    ys, xs = np.nonzero(m); cx, cy = xs.mean(), ys.mean(); rw, rh = (xs.max() - xs.min()) / 2, (ys.max() - ys.min()) / 2
    e = ((xx - cx) / rw) ** 2 + ((yy - cy) / rh) ** 2
    # pupil: fit an ellipse to the painted pupil (dark, not warm), then use the clean ellipse
    warm = (rgb[..., 0] - rgb[..., 2]) > 0.12
    core = m & (e < 0.5 ** 2) & (lum < 0.17) & ~warm
    lab, n = nd.label(core); sizes = nd.sum(core, lab, range(1, n + 1))
    core = lab == (1 + int(np.argmax(sizes)))
    py, px = np.nonzero(core)
    pcx, pcy = px.mean(), py.mean(); prx, pry = 2.0 * px.std(), 2.0 * py.std()
    pe = ((xx - pcx) / prx) ** 2 + ((yy - pcy) / pry) ** 2
    pupil_m |= m & (pe < 1.0)
    info.setdefault('pupil_ellipse_px', {})[side] = [float(pcx), float(pcy), float(prx), float(pry)]
    # glow: brighter than the iris body, in the lower 60%
    body = nd.median_filter(np.where(m, lum, np.nan_to_num(lum)), 31)
    base_lum = np.percentile(lum[m & (e < 0.8 ** 2) & ~core], 35)
    g = np.clip((lum - base_lum - 0.06) / 0.25, 0, 1) * (yy > cy - 0.15 * rh) * m
    glow_m = np.maximum(glow_m, nd.gaussian_filter(g, 2.0))
    info[side] = dict(iris_c=[float(cx) / W, 1 - float(cy) / H], pupil_c=[float(pcx) / W, 1 - float(pcy) / H],
                      iris_r=[float(rw) / W, float(rh) / H])

pupil_a = np.clip(nd.gaussian_filter(pupil_m.astype(np.float32), 4.5), 0, 1)
# like her painted pupil: the lower part melts into the glow
for side, (pcx, pcy, prx, pry) in info['pupil_ellipse_px'].items():
    lower = np.clip((yy - pcy) / pry, 0, 1) * (np.abs(xx - pcx) < 2 * prx)
    pupil_a = pupil_a * (1 - 0.45 * lower)
pupil_col = np.median(rgb[pupil_m & (lum < 0.12)], 0)                                  # her pupil's own colour
glow_a = np.clip(glow_m * 1.15, 0, 1) * (1 - pupil_a)
base = fill(rgb, nd.binary_dilation(pupil_m, iterations=7) | (glow_a > 0.05))
# composite check: base -> glow (over) -> pupil (over) must reproduce the original
comp = base * (1 - glow_a[..., None]) + rgb * glow_a[..., None]
pupil_rgb = np.broadcast_to(pupil_col, rgb.shape).copy()
comp = comp * (1 - pupil_a[..., None]) + pupil_rgb * pupil_a[..., None]
err = np.abs(comp - rgb)[op].mean()
save = lambda arr, al_, n: Image.fromarray((np.clip(np.dstack([arr, al_]), 0, 1) * 255 + 0.5).astype(np.uint8), 'RGBA').save(f'{outd}/{n}')
save(base, al, 'iris_base.png'); save(rgb, glow_a * op, 'iris_glow.png'); save(pupil_rgb, pupil_a * op, 'iris_pupil.png')
json.dump(info, open(f'{outd}/eye_layers.json', 'w'), indent=1)
print('composite error (mean abs, opaque texels):', round(float(err), 4))
print(json.dumps(info))
