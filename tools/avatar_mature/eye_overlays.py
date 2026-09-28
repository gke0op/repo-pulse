# eye_overlays.py <eyelayers_dir> <faceuv.json> <white_tex.png>: signature overlays for the emotion eyes,
# drawn in the iris UV space (star, gems, specks, drops) and the eye-white UV space (veins, tear).
# Ideas picked by the user from concept samples; every pixel here is drawn by this script.
import sys, os, json, glob
import numpy as np
from PIL import Image
from scipy import ndimage as nd

d, uvp, whitep = sys.argv[1:4]
info = json.load(open(f'{d}/eye_layers.json'))
iris = np.asarray(Image.open(f'{d}/iris_base.png').convert('RGBA'))
H, W = iris.shape[:2]; op = iris[..., 3] > 127
yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
def save(rgb, a, name, h=H, w=W):
    rgb = np.broadcast_to(np.asarray(rgb, np.float32), (h, w, 3))
    Image.fromarray((np.clip(np.dstack([rgb, a]), 0, 1) * 255 + 0.5).astype(np.uint8), 'RGBA').save(f'{d}/{name}')

def eye_frames():
    for side in ('left', 'right'):
        pcx, pcy, prx, pry = info['pupil_ellipse_px'][side]
        ic = info[side]['iris_c']; ir = info[side]['iris_r']
        yield side, (pcx, pcy, prx, pry), (ic[0] * W, (1 - ic[1]) * H, ir[0] * W, ir[1] * H)

def star(cx, cy, r, thin=0.13):
    """4-point star: two crossed tapering spikes plus a soft core."""
    u, v = (xx - cx) / r, (yy - cy) / r
    s = np.maximum(np.clip(1 - np.abs(u) - np.abs(v) / thin, 0, 1), np.clip(1 - np.abs(v) - np.abs(u) / thin, 0, 1))
    core = np.clip(1 - np.hypot(u, v) / 0.28, 0, 1)
    return np.clip(np.maximum(s ** 0.7, core), 0, 1)

def diamond(cx, cy, r, aspect=1.25):
    u, v = (xx - cx) / r, (yy - cy) / (r * aspect)
    return np.clip((1 - (np.abs(u) + np.abs(v))) * 6, 0, 1)

def dot(cx, cy, r):
    return np.clip((1 - np.hypot(xx - cx, yy - cy) / r) * 4, 0, 1)

# surprised: a star in the pupil, upper-left of centre
a = np.zeros((H, W), np.float32)
for side, (pcx, pcy, prx, pry), _ in eye_frames():
    a = np.maximum(a, star(pcx - 0.08 * prx, pcy - 0.10 * pry, 1.45 * prx, 0.11))
save((1.0, 0.97, 0.88), a * op, 'iris_star.png')

# curious: faceted catchlights, white upper-left, blue upper-right, a small white one lower-right
rgb = np.ones((H, W, 3), np.float32); a = np.zeros((H, W), np.float32)
for side, _, (icx, icy, irx, iry) in eye_frames():
    w1 = diamond(icx - 0.45 * irx, icy - 0.45 * iry, 0.20 * irx)
    b1 = diamond(icx + 0.50 * irx, icy - 0.50 * iry, 0.18 * irx)
    w2 = diamond(icx + 0.45 * irx, icy + 0.50 * iry, 0.09 * irx)
    a = np.maximum.reduce([a, w1, b1 * 0.9, w2])
    rgb[b1 > 0.05] = (0.35, 0.65, 1.0)
save(rgb, a * op, 'iris_gems.png')

# happy: tiny star specks scattered through the upper iris
rng = np.random.default_rng(12); a = np.zeros((H, W), np.float32)
for side, _, (icx, icy, irx, iry) in eye_frames():
    for _ in range(9):
        ang = rng.uniform(-2.6, -0.5); rad = rng.uniform(0.45, 0.85)
        cx, cy = icx + np.cos(ang) * rad * irx, icy + np.sin(ang) * rad * iry
        a = np.maximum(a, star(cx, cy, rng.uniform(0.06, 0.11) * irx, 0.18) * rng.uniform(0.6, 1.0))
save((1.0, 0.95, 0.82), a * op, 'iris_specks.png')

# sad: small round wet droplets along the iris rim
rng = np.random.default_rng(5); a = np.zeros((H, W), np.float32)
for side, _, (icx, icy, irx, iry) in eye_frames():
    for ang, rad, r in ((-2.4, 0.72, 0.055), (0.4, 0.78, 0.07), (1.2, 0.70, 0.05), (2.3, 0.74, 0.045), (-0.7, 0.62, 0.04)):
        a = np.maximum(a, dot(icx + np.cos(ang) * rad * irx, icy + np.sin(ang) * rad * iry, r * irx * 1.4))
save((0.92, 0.97, 1.0), a * op, 'iris_drops.png')

# ---- eye white: veins and the tear line, placed by physical position on the face
UV = json.load(open(uvp)); ew = UV[next(k for k in UV if 'EyeWhite' in k)]
wim = np.asarray(Image.open(whitep).convert('RGBA'))
WH, WW = wim.shape[:2]
X = np.full((WH, WW), np.nan, np.float32); Z = X.copy()
for tri in ew['tris']:
    t = np.array(tri); px, py = t[:, 0] * WW, (1 - t[:, 1]) * WH
    x0, x1 = int(max(px.min() - 1, 0)), int(min(px.max() + 1, WW - 1)); y0, y1 = int(max(py.min() - 1, 0)), int(min(py.max() + 1, WH - 1))
    gx, gy = np.meshgrid(np.arange(x0, x1 + 1) + 0.5, np.arange(y0, y1 + 1) + 0.5)
    den = (py[1] - py[2]) * (px[0] - px[2]) + (px[2] - px[1]) * (py[0] - py[2])
    if abs(den) < 1e-9: continue
    l1 = ((py[1] - py[2]) * (gx - px[2]) + (px[2] - px[1]) * (gy - py[2])) / den
    l2 = ((py[2] - py[0]) * (gx - px[2]) + (px[0] - px[2]) * (gy - py[2])) / den; l3 = 1 - l1 - l2
    ins = (l1 >= -0.02) & (l2 >= -0.02) & (l3 >= -0.02)
    X[y0:y1 + 1, x0:x1 + 1][ins] = (l1 * t[0, 2] + l2 * t[1, 2] + l3 * t[2, 2])[ins]
    Z[y0:y1 + 1, x0:x1 + 1][ins] = (l1 * t[0, 4] + l2 * t[1, 4] + l3 * t[2, 4])[ins]
ok = ~np.isnan(X); pts = np.array([p[2:] for t in ew['tris'] for p in t])
DX = np.zeros_like(X); DZ = np.zeros_like(X)
for s in (1, -1):
    q = pts[pts[:, 0] * s > 0]; cx, cz = (q[:, 0].min() + q[:, 0].max()) / 2, (q[:, 2].min() + q[:, 2].max()) / 2
    hw, hh = (q[:, 0].max() - q[:, 0].min()) / 2, (q[:, 2].max() - q[:, 2].min()) / 2
    m = ok & (np.nan_to_num(X) * s > 0)
    DX[m] = (X[m] - cx) * s / hw; DZ[m] = (Z[m] - cz) / hh
wyy, wxx = np.mgrid[0:WH, 0:WW]

# veins: thin branching red lines from both corners toward the iris
rng = np.random.default_rng(3); v = np.zeros((WH, WW), np.float32)
for s in (1, -1):
    for start in (1.0, -1.0):
        for k in range(4):
            x, z = start * 0.98, rng.uniform(-0.45, 0.45)
            ang = np.pi if start > 0 else 0.0; ang += rng.uniform(-0.5, 0.5)
            for step in range(26):
                x += np.cos(ang) * 0.022; z += np.sin(ang) * 0.022 * 1.3; ang += rng.normal(0, 0.28)
                if abs(x) < 0.45: break
                hit = ok & (np.nan_to_num(X) * s > 0) & (np.hypot(DX - x, DZ - z) < 0.011 * (1 - step / 34))
                v[hit] = np.maximum(v[hit], 0.7 - 0.018 * step)
v = nd.gaussian_filter(v, 0.6)
save((0.80, 0.08, 0.10), np.clip(v * 1.4, 0, 1) * ok, 'white_veins.png', WH, WW)

# tear: a glassy bead line along the lower edge of the eye opening, brighter rim on top
low = np.full(81, np.nan); bins = np.linspace(-1.1, 1.1, 82); bc = (bins[:-1] + bins[1:]) / 2
for i in range(81):
    m = ok & (DX >= bins[i]) & (DX < bins[i + 1])
    if m.sum() > 3: low[i] = DZ[m].min()
good = ~np.isnan(low); edge = np.interp(DX, bc[good], low[good])
h = DZ - edge
band = ok & (h >= 0) & (h < 0.30) & (np.abs(DX) < 0.92)
fade = np.clip(1 - np.abs(DX) / 0.92, 0, 1) ** 0.5
body = np.where(band, np.clip(1 - h / 0.30, 0, 1) * 0.55, 0) * fade
rim = np.where(band, np.exp(-((h - 0.24) / 0.03) ** 2), 0) * fade
a = np.clip(body + rim, 0, 1)
outline = np.where(ok & (np.abs(DX) < 0.92), np.exp(-((h - 0.29) / 0.02) ** 2), 0) * fade
a = np.clip(body + rim + outline * 0.8, 0, 1)
dark = outline > rim
rgb = np.dstack([np.where(dark, 0.45, 0.80 + 0.2 * rim), np.where(dark, 0.58, 0.90 + 0.1 * rim), np.where(dark, 0.72, 1.0)])
save(rgb, nd.gaussian_filter(a, 0.8), 'white_tear.png', WH, WW)
print('overlays ->', d, 'white tex', WW, WH, 'vein px', int((v > 0.2).sum()), 'tear px', int((a > 0.2).sum()))

# ---- iris tint mask: emission = factor x this, so an emotion can wash the whole iris in a colour
tint = np.zeros((H, W), np.float32)
for side, (pcx, pcy, prx, pry), (icx, icy, irx, iry) in eye_frames():
    e = ((xx - icx) / irx) ** 2 + ((yy - icy) / iry) ** 2
    g = np.clip(0.45 + 0.55 * (yy - (icy - iry)) / (2 * iry), 0, 1)            # brighter toward the bottom
    pupil = np.clip(1 - (((xx - pcx) / prx) ** 2 + ((yy - pcy) / pry) ** 2), 0, 1)
    tint = np.maximum(tint, np.where(e < 1, g * (1 - 0.8 * pupil), 0))
save(np.repeat(nd.gaussian_filter(tint, 2)[..., None], 3, -1), op.astype(np.float32), 'iris_tintmask.png')

# ---- sad: the tear continues across the bottom of the iris (drawn into the drops layer)
dr = np.asarray(Image.open(f'{d}/iris_drops.png').convert('RGBA')).astype(np.float32) / 255
ta = np.zeros((H, W), np.float32); trgb = np.ones((H, W, 3), np.float32)
for side, _, (icx, icy, irx, iry) in eye_frames():
    xn = (xx - icx) / irx
    bottom = icy + iry * np.sqrt(np.clip(1 - xn ** 2, 0, 1))                    # iris lower edge
    h = (bottom - yy) / iry                                                     # 0 at the edge, up into the iris
    band = (np.abs(xn) < 0.95) & (h > -0.02) & (h < 0.22)
    body = np.where(band, 0.45 * np.clip(1 - h / 0.22, 0, 1), 0)
    rim = np.where(np.abs(xn) < 0.95, np.exp(-((h - 0.19) / 0.025) ** 2), 0)
    ta = np.maximum.reduce([ta, body, rim])
    trgb[band] = (0.80, 0.90, 1.0)
a2 = np.maximum(dr[..., 3], ta * op); rgb2 = np.where((ta * op > dr[..., 3])[..., None], trgb, dr[..., :3])
save(rgb2, a2, 'iris_drops.png')
print('tint mask + iris tear band written')
