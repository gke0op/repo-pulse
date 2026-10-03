# Accuracy of 4-bit schemes vs the Q8 NumPy reference (teacher-forced over a fixed 80-token sequence)
import sys, numpy as np
sys.path.insert(0, 'llama.cpp/gguf-py')
import ref, gguf
from gguf.quants import dequantize

SEQ = [1, 4093, 198, 1780, 314, 260, 3575, 282, 4649, 47, 2, 198, 1, 520, 9531, 198] + \
      [int(t) for t in "504 3575 282 4649 314 7042 30 7042 314 253 2240 3807 281 260 5761 599 282 260 1798 28 1343 327 624 2844 22387 28 2642 4679 28 284 2642 21627 30 657 314 260 3995 2240 281 4649 284 314 1129 5124 288 347 260 476 26385 282 9017 18 1568 288 624 13329 22387 715 347 260 414 46682 18669 28".split()]
KEYS = ('attn_q', 'attn_k', 'attn_v', 'attn_output', 'ffn_gate', 'ffn_up', 'ffn_down')

def q4_rtn(W):
    b = W.reshape(-1, 32)
    i = np.abs(b).argmax(1)
    mx = b[np.arange(len(b)), i]
    d = (mx / -8.0)[:, None].astype(np.float16).astype(np.float32)
    inv = np.where(d != 0, 1 / d, 0)
    q = np.clip(np.round(b * inv) + 8, 0, 15)
    return ((q - 8) * d).reshape(W.shape)

def q4_search(W):
    b = W.reshape(-1, 32)
    i = np.abs(b).argmax(1)
    mx = b[np.arange(len(b)), i]
    best = None; besterr = None
    for f in np.linspace(-7.0, -9.0, 21):  # candidate denominators around -8
        d = (mx / f)[:, None].astype(np.float16).astype(np.float32)
        inv = np.where(d != 0, 1 / d, 0)
        r = (np.clip(np.round(b * inv) + 8, 0, 15) - 8) * d
        e = ((r - b) ** 2).sum(1)
        if best is None: best, besterr = r, e
        else:
            m = e < besterr; best[m] = r[m]; besterr[m] = e[m]
    return best.reshape(W.shape)

def run_with(fn):
    E0, L0 = ref.E, ref.layers
    ref.E = fn('token_embd.weight', E0)
    ref.layers = [{k: (fn(f'blk.{i}.{k}.weight', w[k]) if k in KEYS else w[k]) for k in w} for i, w in enumerate(L0)]
    out = ref.run(SEQ)
    ref.E, ref.layers = E0, L0
    return out

def score(name, lg, base):
    lp = lambda z: z - np.log(np.exp(z - z.max(-1, keepdims=True)).sum(-1, keepdims=True)) - z.max(-1, keepdims=True)
    pb, pq = lp(base), lp(lg)
    kl = (np.exp(pb) * (pb - pq)).sum(-1)
    top1 = (lg.argmax(-1) == base.argmax(-1)).mean()
    corr = np.mean([np.corrcoef(lg[p], base[p])[0, 1] for p in range(len(lg))])
    print(f'{name:28s} top1 agree={top1*100:5.1f}%  mean KL={kl.mean():.4f}  p99 KL={np.quantile(kl,.99):.3f}  corr={corr:.5f}', flush=True)

R4 = gguf.GGUFReader('s4.gguf'); T4 = {t.name: t for t in R4.tensors}
def qk(name, W):
    t = T4[name]
    return dequantize(np.asarray(t.data), t.tensor_type).reshape(W.shape).astype(np.float32)
if __name__ == "__main__":
  base = ref.run(SEQ)
  np.save("base80.npy", base)
  score('Q8_0 (reference)', base, base)


  print('Q4_K_M tensor types:', sorted({T4[n].tensor_type.name for n in T4 if n.endswith('.weight') and 'norm' not in n}))
  score('llama.cpp Q4_K_M (imatrix)', run_with(qk), base)
  score('ours Q4 round-to-nearest', run_with(lambda n, W: q4_rtn(W)), base)
  score('ours Q4 + scale search', run_with(lambda n, W: q4_search(W)), base)
