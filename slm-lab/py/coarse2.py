# Cheaper coarse plane for the vocab head: one 4-bit scale per G weights (G=128 or whole row 640),
# activations int8 with one scale per G. O(1)-per-row sigma from precomputed row error energies.
import numpy as np, gemma
Hs = np.load('g_hidden.npy'); T = len(Hs)
q, d = gemma.q8('token_embd.weight'); df = d.astype(np.float32)
Wq8 = None
def xq_blocks(X, G):
    xb = X.reshape(len(X), -1, G); xd = np.abs(xb).max(-1) / 127.0
    xq = np.round(xb / np.where(xd > 0, xd, 1)[..., None])
    return (xq * xd[..., None]).reshape(len(X), -1)
Xt = xq_blocks(Hs, 32)              # engine's activations (truth path)
for G in (128, 640):
    Xc = xq_blocks(Hs, G)           # coarse-path activations
    dX = Xt - Xc                    # activation quant mismatch (known per token)
    V = len(q); z = np.empty((T, V), np.float32); c = np.empty_like(z); E = np.empty(V, np.float32); Wn = np.empty(V, np.float32)
    for a in range(0, V, 32768):
        sl = slice(a, a + 32768)
        W = (q[sl].astype(np.float32).reshape(-1, 20, 32) * df[sl, :, None]).reshape(-1, 640)
        wb = W.reshape(-1, 640 // G, G); s = np.abs(wb).max(-1, keepdims=True) / 7.0
        Wc = (np.clip(np.round(wb / np.where(s > 0, s, 1)), -8, 7) * s).reshape(-1, 640)
        z[:, sl] = Xt @ W.T; c[:, sl] = Xc @ Wc.T
        E[sl] = ((W - Wc) ** 2).sum(1); Wn[sl] = (Wc ** 2).sum(1)
    # sigma_r^2 ~ E_r/640 * |x|^2 + Wn_r/640 * |dx|^2   (weight-error term + activation-quant term)
    sig = np.sqrt(np.outer((Xt ** 2).sum(1), E / 640) + np.outer((dX ** 2).sum(1), Wn / 640))
    r = np.abs(z - c) / sig
    print(f'G={G}: max |err|/sigma={r.max():.2f}  frac>4sig={np.mean(r > 4):.1e}', flush=True)
    for k in (6, 7, 8):
        LB = (c - k * sig).max(1, keepdims=True); nc = (c + k * sig >= LB).sum(1)
        kept = np.mean([(c[t] + k * sig[t])[z[t].argmax()] >= LB[t, 0] for t in range(T)])
        print(f'   k={k}: candidates median={int(np.median(nc))} p90={int(np.quantile(nc,.9))} mean={int(nc.mean())} max={nc.max()}  argmax kept {kept*100:.0f}%', flush=True)
    del z, c, r, sig
