# Can coarse bit-planes of the Q8 vocab head shortlist the true top tokens? (real final hidden states)
import numpy as np, gemma
ids = [int(t) for t in open('gcalib.txt').read().split(',')]
E, Ls, on = gemma.load()
hs = []
orig_rms = gemma.rms
def run_capture(tokens):  # same as gemma.run but returns final normed hidden states
    gemma_E = E
    out = []
    import types
    lg = gemma.run(tokens, E, Ls, on)  # logits
    return lg
q, d = gemma.q8('token_embd.weight')  # int8 [V,640], f16 scales [V,20]
df = d.astype(np.float32)
# recover final hidden states h from exact logits is not possible; recompute by hooking: patch E @ rms(x,on)
H_ = []
class Hook(np.ndarray): pass
orig_run = gemma.run
def rms_hook(x, w):
    r = orig_rms(x, w)
    if w is on: H_.append(r.copy())
    return r
gemma.rms = rms_hook
exact = gemma.run(ids, E, Ls, on)
gemma.rms = orig_rms
Hs = np.stack(H_)  # [T,640]
print('positions', len(Hs))
def logits_with(qw):
    W = (qw.astype(np.float32).reshape(-1, 20, 32) * df[:, :, None]).reshape(-1, 640)
    return Hs @ W.T
truth = logits_with(q)
top1 = truth.argmax(1); top10 = np.argsort(-truth, 1)[:, :10]
for bits in (4, 3, 2, 1):
    if bits == 1: qc = np.where(q >= 0, 64, -64)  # sign plane only
    else:
        sh = 8 - bits
        qc = ((q.astype(np.int16) >> sh) << sh) + (1 << (sh - 1))  # top-bits plane, midpoint reconstruction
    c = logits_with(qc)
    order = np.argsort(-c, 1)
    for K in (64, 256, 1024, 4096):
        sl = order[:, :K]
        r1 = np.mean([top1[i] in sl[i] for i in range(len(Hs))])
        r10 = np.mean([len(set(top10[i]) & set(sl[i])) / 10 for i in range(len(Hs))])
        print(f'top {bits}-bit plane(s) ({bits/8*100:3.0f}% of head bytes)  shortlist K={K:5d}: top1 recall={r1*100:5.1f}%  top10 recall={r10*100:5.1f}%')
