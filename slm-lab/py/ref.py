# Independent f32 NumPy reference (dequantized Q8 weights, exact f32 activations)
import sys, numpy as np
sys.path.insert(0, '.')
from convert import q8, f32  # noqa  (convert.py runs on import; guard below)

L, D, H, KVH, HD, F = 30, 576, 9, 3, 64, 1536
theta, eps = 100000.0, 1e-5

def W(n):
    q, d = q8(n)
    return (q.astype(np.float32).reshape(q.shape[0], -1, 32) * d.astype(np.float32)[:, :, None]).reshape(q.shape[0], -1)

E = W('token_embd.weight')
layers = []
for i in range(L):
    p = f'blk.{i}.'
    layers.append({k: (f32(p + k + '.weight') if 'norm' in k else W(p + k + '.weight'))
                   for k in ('attn_norm', 'attn_q', 'attn_k', 'attn_v', 'attn_output', 'ffn_norm', 'ffn_gate', 'ffn_up', 'ffn_down')})
onorm = f32('output_norm.weight')

def rms(x, w): return x / np.sqrt(np.mean(x * x) + eps) * w
def rope(x, pos):  # adjacent pairs (llama.cpp NORM rope on GGUF-permuted weights)
    x = x.reshape(-1, HD // 2, 2)
    f = theta ** (-np.arange(0, HD, 2) / HD) * pos
    c, s = np.cos(f), np.sin(f)
    a, b = x[..., 0], x[..., 1]
    return np.stack([a * c - b * s, a * s + b * c], -1).reshape(-1, HD)

def run(tokens):
    Kc = [[] for _ in range(L)]; Vc = [[] for _ in range(L)]
    outs = []
    for pos, t in enumerate(tokens):
        x = E[t].copy()
        for i, w in enumerate(layers):
            h = rms(x, w['attn_norm'])
            q = rope((w['attn_q'] @ h), pos); k = rope((w['attn_k'] @ h), pos); v = (w['attn_v'] @ h).reshape(KVH, HD)
            Kc[i].append(k); Vc[i].append(v)
            Ks = np.stack(Kc[i]); Vs = np.stack(Vc[i])  # [T,KVH,HD]
            o = np.zeros((H, HD), np.float32)
            for hh in range(H):
                g = hh // (H // KVH)
                a = Ks[:, g] @ q[hh] / np.sqrt(HD)
                a = np.exp(a - a.max()); a /= a.sum()
                o[hh] = a @ Vs[:, g]
            x = x + w['attn_output'] @ o.reshape(-1)
            h = rms(x, w['ffn_norm'])
            g_ = w['ffn_gate'] @ h
            x = x + w['ffn_down'] @ (g_ / (1 + np.exp(-g_)) * (w['ffn_up'] @ h))
        outs.append(E @ rms(x, onorm))
    return np.stack(outs)

if __name__ == '__main__':
    toks = [int(t) for t in sys.argv[1].split(',')]
    lg = run(toks)
    np.save('ref_logits.npy', lg.astype(np.float32))
    print('ref argmax per pos:', lg.argmax(-1).tolist())
