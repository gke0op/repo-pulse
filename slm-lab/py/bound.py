import numpy as np, gemma
Hs = np.load('g_hidden.npy')
q, d = gemma.q8('token_embd.weight'); df = np.abs(d.astype(np.float32))
xb = Hs.reshape(len(Hs), 20, 32); xd = np.abs(xb).max(-1) / 127.0
xq = np.round(xb / np.where(xd > 0, xd, 1)[..., None]).astype(np.float32)
X = (xq * xd[..., None]).reshape(len(Hs), -1)           # engine's dequantized activations [T,640]
A = xd * np.abs(xq).sum(-1)                              # [T,20]
V = len(q); T = len(Hs)
for s, name in ((4, 'top 4 bits'), (5, 'top 3 bits')):
    m = ((1 << s) - 1) / 2
    z = np.empty((T, V), np.float32); c = np.empty((T, V), np.float32); B = np.empty((T, V), np.float32)
    for a in range(0, V, 32768):
        sl = slice(a, a + 32768)
        W = (q[sl].astype(np.float32).reshape(-1, 20, 32) * df[sl, :, None]).reshape(-1, 640)
        hi = ((q[sl].astype(np.int16) >> s) << s).astype(np.float32) + m
        Wc = (hi.reshape(-1, 20, 32) * df[sl, :, None]).reshape(-1, 640)
        z[:, sl] = X @ W.T; c[:, sl] = X @ Wc.T; B[:, sl] = m * (A @ df[sl].T)
        del W, Wc, hi
    assert np.all(np.abs(z - c) <= B * 1.0001 + 1e-4), 'bound violated'
    LB = (c - B).max(1, keepdims=True)
    nc = (c + B >= LB).sum(1)
    kept = np.mean([(c[t] + B[t])[z[t].argmax()] >= LB[t, 0] for t in range(T)])
    # how loose is the worst-case bound vs actual error?
    ratio = np.median(np.abs(z - c) / np.maximum(B, 1e-9))
    print(f'{name}: exact-bound candidates median={int(np.median(nc))} p90={int(np.quantile(nc,.9))} max={nc.max()} of {V};  true argmax kept {kept*100:.0f}%;  median |err|/bound={ratio:.3f}', flush=True)
    del z, c, B
