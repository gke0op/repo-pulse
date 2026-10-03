# Activation-aware 4-bit: (1) E[x^2]-weighted scale search, (2) AWQ-style foldable channel scaling
import ast, numpy as np, ref, qexp

KEYS = qexp.KEYS
stats = {}

class Rec:
    def __init__(s, W, key): s.W, s.key = W, key
    def __matmul__(s, x):
        a = stats.setdefault(s.key, [np.zeros(x.shape[-1], np.float64), 0])
        a[0] += x.astype(np.float64) ** 2; a[1] += 1
        return s.W @ x
    def __getitem__(s, i): return s.W[i]

# collect stats on calibration text (never the eval sequence)
calib = ast.literal_eval(open('calib_ids.txt').read())
E0, L0 = ref.E, ref.layers
ref.E = Rec(E0, 'token_embd.weight')
ref.layers = [{k: (Rec(w[k], f'blk.{i}.{k}.weight') if k in KEYS else w[k]) for k in w} for i, w in enumerate(L0)]
ref.run(calib)
ref.E, ref.layers = E0, L0
imat = {k: (v[0] / v[1]).astype(np.float32) for k, v in stats.items()}
np.savez('imatrix.npz', **imat)
print('collected', len(imat), 'activation stats from', len(calib), 'calib tokens', flush=True)

def q4_wsearch(W, a):
    """per-32 block absmax scale, searched to minimize sum_j a_j (w_j - q_j)^2"""
    b = W.reshape(-1, 32); aw = np.broadcast_to(a.reshape(-1, 32), (W.shape[0], W.shape[1] // 32, 32)).reshape(-1, 32)
    i = np.abs(b).argmax(1); mx = b[np.arange(len(b)), i]
    best = None; be = None
    for f in np.linspace(-6.5, -9.5, 31):
        d = (mx / f)[:, None].astype(np.float16).astype(np.float32)
        inv = np.where(d != 0, 1 / d, 0)
        r = (np.clip(np.round(b * inv) + 8, 0, 15) - 8) * d
        e = (aw * (r - b) ** 2).sum(1)
        if best is None: best, be = r, e
        else: m = e < be; best[m] = r[m]; be[m] = e[m]
    return best.reshape(W.shape)

def awq(qfn, alpha):
    def g(n, W):
        a = imat[n]
        s = (a / a.mean()) ** (alpha / 2)  # alpha=0 -> identity; s ~ rms(x)^alpha
        s = s.astype(np.float32)
        Ws = W * s[None, :]
        return qfn(Ws, a / (s * s)) / s[None, :]  # error weights in scaled space: a_j / s_j^2
    return g

if __name__ == '__main__':
    base = np.load('base80.npy')
    qexp.score('Q4 RTN (baseline)', qexp.run_with(lambda n, W: qexp.q4_rtn(W)), base)
    qexp.score('Q4 imatrix scale search', qexp.run_with(lambda n, W: q4_wsearch(W, imat[n])), base)
    for al in (0.25, 0.5, 0.75):
        qexp.score(f'Q4 AWQ a={al} + iw-search', qexp.run_with(awq(q4_wsearch, al)), base)
