# Clustered vocab head feasibility: k-means rows, bound cluster max by centroid score + k*rho*|x|/sqrt(D), keep clusters
# whose upper bound beats an exact lower bound (best row of the top centroid clusters). Count rows read.
import numpy as np, gemma, time
Hs = np.load('g_hidden.npy').astype(np.float32); T = len(Hs)
q, d = gemma.q8('token_embd.weight')
W = (q.astype(np.float32).reshape(-1, 20, 32) * d.astype(np.float32)[:, :, None]).reshape(-1, 640)
V = len(W); rng = np.random.default_rng(0)
z = Hs @ W.T                                   # exact logits [T,V]
truth = z.argmax(1)
xn = np.linalg.norm(Hs, axis=1)
wn2 = (W * W).sum(1)
for K in (1024,):
    t0 = time.time()
    C = W[rng.choice(V, K, replace=False)].copy()
    for it in range(6):
        lab = np.empty(V, np.int64)
        cn2 = (C * C).sum(1)
        for a in range(0, V, 16384):
            lab[a:a+16384] = (cn2[None, :] - 2 * W[a:a+16384] @ C.T).argmin(1)
        cnt = np.bincount(lab, minlength=K)
        C = np.zeros_like(C); np.add.at(C, lab, W); C /= np.maximum(cnt, 1)[:, None]
    dev = np.linalg.norm(W - C[lab], axis=1)
    rho = np.zeros(K); np.maximum.at(rho, lab, dev)
    print(f'K={K}: kmeans {time.time()-t0:.0f}s  cluster sizes median={int(np.median(cnt))} max={cnt.max()}  '
          f'median |w-c|/|w| = {np.median(dev/np.sqrt(wn2)):.3f}', flush=True)
    cs = Hs @ C.T                               # centroid scores [T,K]
    # empirical: max over rows of (w_r - c)·x / (|w_r - c| |x| / sqrt(640))
    e = (z - cs[:, lab]) / (dev[None, :] * xn[:, None] / np.sqrt(640) + 1e-9)
    print(f'   max deviation in sigma units: {np.abs(e).max():.2f}', flush=True)
    for k in (8, 12):
        rows = []; ok = 0
        for t in range(T):
            ub = cs[t] + k * rho * xn[t] / np.sqrt(640)
            top = [g for g in np.argsort(-cs[t]) if cnt[g] > 0][:4]  # exact lower bound from 4 best non-empty clusters
            lb = max(z[t][lab == g].max() for g in top)
            keep = ub >= lb
            rows.append(cnt[keep].sum()); ok += keep[lab[truth[t]]]
        rows = np.array(rows)
        print(f'   k={k}: rows read median={int(np.median(rows))} mean={int(rows.mean())} p90={int(np.quantile(rows,.9))} of {V} '
              f'(+{K} centroids)  argmax kept {ok}/{T}', flush=True)
