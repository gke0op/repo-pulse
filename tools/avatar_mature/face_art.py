# face_art.py <char> <faceuv.json> <tex_dir> <out_dir>
# Draws our own eyes, brows, lashes and face marks for Mira/Kai. Every texel of a face material is
# mapped back to its physical position on the face (X lateral, Z up, metres; barycentric over the
# mesh's own UV triangles), so shapes are designed in millimetres around each eye and land exactly
# on the existing geometry. Output PNGs keep each original texture's size and name.
import sys, json, os, glob
import numpy as np
from PIL import Image
from scipy import ndimage as nd

char, uvp, texd, outd = sys.argv[1:5]
os.makedirs(outd, exist_ok=True)
UV = json.load(open(uvp))
MIRA = char == 'mira'


def mat(sub):
    k = next(k for k in UV if sub in k)
    return UV[k]


def load(img_name):
    f = glob.glob(f'{texd}/*_{img_name}.png')[0]
    return np.asarray(Image.open(f).convert('RGBA')).astype(np.float32) / 255, f


def physmap(m, W, H):
    """Per-texel physical X, Z (NaN outside the material's UV triangles)."""
    X = np.full((H, W), np.nan, np.float32); Z = X.copy()
    for tri in m['tris']:
        t = np.array(tri)                       # rows: u, v, x, y, z
        px, py = t[:, 0] * W, (1 - t[:, 1]) * H
        x0, x1 = int(max(np.floor(px.min()) - 1, 0)), int(min(np.ceil(px.max()) + 1, W - 1))
        y0, y1 = int(max(np.floor(py.min()) - 1, 0)), int(min(np.ceil(py.max()) + 1, H - 1))
        if x1 < x0 or y1 < y0: continue
        gx, gy = np.meshgrid(np.arange(x0, x1 + 1) + 0.5, np.arange(y0, y1 + 1) + 0.5)
        d = (py[1] - py[2]) * (px[0] - px[2]) + (px[2] - px[1]) * (py[0] - py[2])
        if abs(d) < 1e-9: continue
        a = ((py[1] - py[2]) * (gx - px[2]) + (px[2] - px[1]) * (gy - py[2])) / d
        b = ((py[2] - py[0]) * (gx - px[2]) + (px[0] - px[2]) * (gy - py[2])) / d
        c = 1 - a - b
        ins = (a >= -0.02) & (b >= -0.02) & (c >= -0.02)
        X[y0:y1 + 1, x0:x1 + 1][ins] = (a * t[0, 2] + b * t[1, 2] + c * t[2, 2])[ins]
        Z[y0:y1 + 1, x0:x1 + 1][ins] = (a * t[0, 4] + b * t[1, 4] + c * t[2, 4])[ins]
    return X, Z


def sm(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t)


def hexl(h): return np.array([int(h[i:i + 2], 16) / 255 for i in (1, 3, 5)], np.float32)


def save(arr, path):
    Image.fromarray((np.clip(arr, 0, 1) * 255 + 0.5).astype(np.uint8), 'RGBA').save(path)


# ---------------------------------------------------------------- landmarks: eye whites, per side
ew = mat('EyeWhite')
pts = np.array([p[2:] for t in ew['tris'] for p in t])
EYES = {}
for s in (1, -1):
    q = pts[pts[:, 0] * s > 0]
    EYES[s] = dict(cx=(q[:, 0].min() + q[:, 0].max()) / 2, cz=(q[:, 2].min() + q[:, 2].max()) / 2,
                   hw=(q[:, 0].max() - q[:, 0].min()) / 2, hh=(q[:, 2].max() - q[:, 2].min()) / 2)
side = lambda X: np.where(X > 0, 1, -1)
def rel(X, Z):
    """Per texel: dx (+ = outer corner), dz, in units of that eye's half-width/height."""
    s = side(np.nan_to_num(X)); cx = np.where(s > 0, EYES[1]['cx'], EYES[-1]['cx'])
    cz = np.where(s > 0, EYES[1]['cz'], EYES[-1]['cz']); hw = EYES[1]['hw']; hh = EYES[1]['hh']
    return (X - cx) * s / hw, (Z - cz) / hh

print('eyes', {k: {a: round(b * 1000, 1) for a, b in v.items()} for k, v in EYES.items()}, '(mm)')

# ---------------------------------------------------------------- iris
m = mat('EyeIris'); img, f = load(m['image']); H, W = img.shape[:2]
X, Z = physmap(m, W, H)
# the painted iris ellipse, measured from the original alpha
own = img[..., 3] > 0.5
IR = {}
for s in (1, -1):
    k = own & (side(np.nan_to_num(X)) == s) & ~np.isnan(X)
    IR[s] = ((X[k].min() + X[k].max()) / 2, (Z[k].min() + Z[k].max()) / 2,
             (X[k].max() - X[k].min()) / 2, (Z[k].max() - Z[k].min()) / 2)
s_ = side(np.nan_to_num(X))
icx = np.where(s_ > 0, IR[1][0], IR[-1][0]); icz = np.where(s_ > 0, IR[1][1], IR[-1][1])
dx, dz = (X - icx) * s_ / IR[1][2], (Z - icz) / IR[1][3]
r = np.hypot(dx, dz); th = np.arctan2(dz, dx)
rng = np.random.default_rng(7 if MIRA else 11)
noise = nd.gaussian_filter(rng.standard_normal((H, W)), 3) * 6
if MIRA:
    top, mid, low, ring, coll = hexl('#5a2c10'), hexl('#e0a040'), hexl('#f7cf6a'), hexl('#3a2410'), hexl('#3fa7a0')
    pupil_r = 0.34 * (1 + 0.10 * np.cos(4 * th))               # soft four-petal pupil
else:
    top, mid, low, ring, coll = hexl('#223832'), hexl('#6f9a8c'), hexl('#a9c7b9'), hexl('#243038'), hexl('#4d6f66')
    pupil_r = 0.30 / np.hypot(np.cos(th) * 1.5, np.sin(th))
g = sm(-0.9, 0.9, -dz)[..., None]                                # 0 at top, 1 at bottom
col = np.where(g < 0.5, top + (mid - top) * (g / 0.5), mid + (low - mid) * ((g - 0.5) / 0.5))
stri = (0.5 + 0.5 * np.cos(36 * th + noise))[..., None]
col = col * (0.88 + 0.12 * stri)
cw = np.exp(-((r - 0.55) / 0.07) ** 2)[..., None] * (0.55 if MIRA else 0.35)
col = col * (1 - cw) + coll * cw                                  # collarette ring
lim = sm(0.78, 0.97, r)[..., None]
col = col * (1 - lim) + ring * lim                                # limbal ring
pup = (1 - sm(pupil_r - 0.03, pupil_r + 0.03, r))[..., None]
col = col * (1 - pup) + hexl('#120a08' if MIRA else '#0b1012') * pup
alpha = (1 - sm(0.97, 1.02, r)) * ~np.isnan(X)
out = np.dstack([np.nan_to_num(col), np.nan_to_num(alpha)])
out[np.isnan(X)] = 0
save(out, f'{outd}/{os.path.basename(f)}')
print('iris', {k: tuple(round(x * 1000, 1) for x in v) for k, v in IR.items()}, '(mm)')

# ---------------------------------------------------------------- highlight (same iris frame)
m = mat('EyeHighlight'); img, f = load(m['image']); H, W = img.shape[:2]
X, Z = physmap(m, W, H); s_ = side(np.nan_to_num(X))
icx = np.where(s_ > 0, IR[1][0], IR[-1][0]); icz = np.where(s_ > 0, IR[1][1], IR[-1][1])
# highlights sit on the same side of both eyes (one light), so use unmirrored X here
hx, hz = (X - icx) / IR[1][2], (Z - icz) / IR[1][3]
def blob(cx, cz, rx, rz, ang=0.0, soft=0.25):
    ca, sa = np.cos(ang), np.sin(ang)
    u, v = (hx - cx) * ca + (hz - cz) * sa, -(hx - cx) * sa + (hz - cz) * ca
    d = np.hypot(u / rx, v / rz)
    return 1 - sm(1 - soft, 1 + soft * 0.3, d)
if MIRA:
    a = np.maximum(blob(-0.32, 0.38, 0.26, 0.17, 0.5), blob(0.36, -0.40, 0.09, 0.09, 0, 0.4) * 0.9)
else:
    a = blob(-0.28, 0.36, 0.15, 0.10, 0.2, 0.15)                  # one small, calm glint
a = np.nan_to_num(a) * ~np.isnan(X)
out = np.dstack([np.ones((H, W, 3), np.float32), a])
save(out, f'{outd}/{os.path.basename(f)}')

# ---------------------------------------------------------------- upper eyeline: along the measured lid
m = mat('FaceEyeline'); img, f = load(m['image']); H, W = img.shape[:2]
X, Z = physmap(m, W, H); DX, DZ = rel(X, Z)
dark = (img[..., 3] > 0.6) & (img[..., :3].mean(-1) < 0.35) & ~np.isnan(X)
# lid curve: lower edge of the original dark stroke, per dx bin (both eyes pooled, mirrored)
bins = np.linspace(-1.3, 1.3, 53); lid = np.full(len(bins) - 1, np.nan)
for i in range(len(bins) - 1):
    k = dark & (DX >= bins[i]) & (DX < bins[i + 1])
    if k.sum() > 5: lid[i] = np.percentile(DZ[k], 8)
ok = ~np.isnan(lid); bc = (bins[:-1] + bins[1:]) / 2
lid_at = lambda d: np.interp(d, bc[ok], lid[ok])
x_in, x_out = bc[ok].min(), bc[ok].max()
L = lid_at(np.clip(DX, x_in, x_out))
t_frac = sm(x_in, x_out, DX)
if MIRA:   # thin at the inner corner, fuller toward the outside (no wing: the strip past the corner folds)
    thick = 0.09 + 0.15 * t_frac
    upper = (DZ >= L - 0.02) & (DZ <= L + thick) & (DX <= x_out - 0.04)
else:      # a clean even line that stops before the corner dips
    thick = 0.07 + 0.03 * np.sin(np.pi * np.clip((DX - x_in) / (x_out - x_in), 0, 1))
    upper = (DZ >= L - 0.02) & (DZ <= L + thick) & (DX <= x_out - 0.10)
upper &= (DX >= x_in - 0.02) & ~np.isnan(X)
a = nd.gaussian_filter(upper.astype(np.float32), 0.8)
keep_lower = (img[..., 3] > 0) & ~np.isnan(X) & (DZ < np.nan_to_num(L) - 0.12) & (DX > x_in + 0.15) & (DX < x_out - 0.15)   # lower-lid pieces stay, VRoid's corner tails go
out = np.zeros((H, W, 4), np.float32)
out[..., :3] = 0.08; out[..., 3] = a
lo = keep_lower & (a < 0.05)
out[lo] = img[lo] * np.array([1, 1, 1, 0.8 if MIRA else 0.5], np.float32)
save(out, f'{outd}/{os.path.basename(f)}')
print('lid span dx', round(x_in, 2), round(x_out, 2))

# ---------------------------------------------------------------- lashes
m = mat('FaceEyelash'); img, f = load(m['image']); H, W = img.shape[:2]
X, Z = physmap(m, W, H); DX, DZ = rel(X, Z)
out = np.zeros((H, W, 4), np.float32); out[..., :3] = 0.08
if MIRA:   # three soft flicks off the outer third, following the lid
    a = np.zeros((H, W), np.float32)
    for x0, ln, ang in [(0.55, 0.28, 0.9), (0.72, 0.34, 0.7), (0.88, 0.30, 0.45)]:
        base = lid_at(x0) + 0.12
        u, v = DX - x0, DZ - base
        along = u * np.cos(ang) + v * np.sin(ang); across = -u * np.sin(ang) + v * np.cos(ang)
        w = 0.045 * (1 - np.clip(along / ln, 0, 1))
        a = np.maximum(a, ((along >= 0) & (along <= ln) & (np.abs(across) <= w)).astype(np.float32))
    out[..., 3] = nd.gaussian_filter(a, 0.7) * ~np.isnan(X)
save(out, f'{outd}/{os.path.basename(f)}')

# ---------------------------------------------------------------- brows
m = mat('FaceBrow'); img, f = load(m['image']); H, W = img.shape[:2]
X, Z = physmap(m, W, H); DX, DZ = rel(X, Z)
orig = (img[..., 3] > 0.5) & ~np.isnan(X)
zc = np.median(DZ[orig])                                          # where the brow sat
if MIRA:   # thin, arched, peak two-thirds out, tapering tail
    x0, x1 = -0.75, 1.30
    p = np.clip((DX - x0) / (x1 - x0), 0, 1)
    centre = zc - 0.05 + 0.32 * np.sin(np.pi * np.clip(p / 1.15, 0, 1)) - 0.25 * sm(0.7, 1.0, p)
    half = 0.10 * (1 - 0.75 * sm(0.55, 1.0, p)) * (0.7 + 0.3 * sm(0.0, 0.15, p))
else:      # straighter and heavier, a slight fall at the tail
    x0, x1 = -0.85, 1.20
    p = np.clip((DX - x0) / (x1 - x0), 0, 1)
    centre = zc + 0.06 - 0.12 * p ** 2
    half = 0.17 * (1 - 0.45 * sm(0.6, 1.0, p)) * (0.75 + 0.25 * sm(0.0, 0.12, p))
brow = (np.abs(DZ - centre) <= half) & (DX >= x0) & (DX <= x1) & ~np.isnan(X)
a = nd.gaussian_filter(brow.astype(np.float32), 0.9)
shade = 0.75 + 0.25 * sm(0.0, 0.4, p)                            # denser at the head, lighter tail
out = np.dstack([np.repeat(shade[..., None], 3, -1), a]).astype(np.float32)
out[np.isnan(X)] = 0
save(out, f'{outd}/{os.path.basename(f)}')
print('brow orig z (eye units)', round(float(zc), 2), 'coverage', round(float((a > 0.5).sum() / max(orig.sum(), 1)), 2))

# ---------------------------------------------------------------- face skin: nose, beauty mark
m = mat('Face_00_SKIN'); img, f = load(m['image']); H, W = img.shape[:2]
X, Z = physmap(m, W, H)
rgb = img[..., :3].copy()
eye_z, hw, hh = EYES[1]['cz'], EYES[1]['hw'], EYES[1]['hh']
mouth = np.array([p[2:] for t in mat('FaceMouth')['tris'] for p in t])
mouth_z = np.median(mouth[:, 2])
nose_z = eye_z - 0.55 * (eye_z - mouth_z)
# VRoid's nose tick: dark pixels near the midline at nose height -> fill from surroundings
near = ~np.isnan(X) & (np.abs(X) < 0.35 * hw) & (np.abs(Z - nose_z) < 0.9 * hh)
lum = rgb.mean(-1); base = nd.median_filter(lum, 25)
tick = near & (lum < base - 0.03)
tick = nd.binary_dilation(tick, iterations=3)
good = (~tick).astype(np.float32)
for c in range(3):
    num, den = nd.gaussian_filter(rgb[..., c] * good, 6), nd.gaussian_filter(good, 6)
    rgb[..., c] = np.where(tick, num / np.maximum(den, 1e-4), rgb[..., c])
# our nose: a soft shadow on one side of the tip, like a single light from the key side
shadow = np.exp(-(((X - 0.12 * hw) / (0.12 * hw)) ** 2 + ((Z - (nose_z - 0.1 * hh)) / (0.22 * hh)) ** 2))
shadow = np.nan_to_num(shadow)
rgb = rgb * (1 - 0.07 * shadow[..., None] * np.array([0.5, 1.0, 1.0], np.float32))   # warm, not grey
if MIRA and os.environ.get('CYBER'):   # freckles: a light scatter over the nose bridge and upper cheeks
    rng2 = np.random.default_rng(31)
    for _ in range(30):
        side_ = rng2.choice([-1, 1]); ax = abs(rng2.normal(0.0, 0.75))
        fx = side_ * min(ax, 1.6) * hw * 0.9
        fz = eye_z - (1.45 + rng2.normal(0, 0.35) + 0.25 * (ax / 1.6)) * hh
        r_ = rng2.uniform(0.00045, 0.0008)
        d = np.nan_to_num(np.hypot(X - fx, Z - fz) / r_, nan=9)
        dot = (1 - sm(0.6, 1.2, d)) * rng2.uniform(0.22, 0.42)
        rgb = rgb * (1 - dot[..., None]) + hexl('#a0583a') * dot[..., None]
elif MIRA:   # beauty mark under her left eye, toward the outer corner
    bx, bz = EYES[1]['cx'] + 0.55 * hw, eye_z - 1.65 * hh
    d = np.nan_to_num(np.hypot(X - bx, Z - bz) / 0.0011, nan=9)
    mark = 1 - sm(0.7, 1.15, d)
    rgb = rgb * (1 - mark[..., None]) + hexl('#4a2a26') * mark[..., None]
out = np.dstack([rgb, img[..., 3]])
save(out, f'{outd}/{os.path.basename(f)}')
print('face: nose tick texels', int(tick.sum()), 'nose z', round(nose_z, 4))
