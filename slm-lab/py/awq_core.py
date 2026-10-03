import numpy as np
def q4_rtn(W):
    b = W.reshape(-1, 32); mx = b[np.arange(len(b)), np.abs(b).argmax(1)]
    d = (mx / -8.0)[:, None].astype(np.float16).astype(np.float32); inv = np.where(d != 0, 1 / d, 0)
    return ((np.clip(np.round(b * inv) + 8, 0, 15) - 8) * d).reshape(W.shape)
def q4_wsearch(W, a):
    b = W.reshape(-1, 32); aw = np.broadcast_to(a.reshape(-1, 32), (W.shape[0], W.shape[1] // 32, 32)).reshape(-1, 32)
    mx = b[np.arange(len(b)), np.abs(b).argmax(1)]; best = be = None
    for f in np.linspace(-6.5, -9.5, 31):
        d = (mx / f)[:, None].astype(np.float16).astype(np.float32); inv = np.where(d != 0, 1 / d, 0)
        r = (np.clip(np.round(b * inv) + 8, 0, 15) - 8) * d; e = (aw * (r - b) ** 2).sum(1)
        if best is None: best, be = r, e
        else: m = e < be; best[m] = r[m]; be[m] = e[m]
    return best.reshape(W.shape)
def awq_q(W, a, alpha):
    s = ((a / a.mean()) ** (alpha / 2)).astype(np.float32)
    return q4_wsearch(W * s[None, :], a / (s * s)) / s[None, :]
