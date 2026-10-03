# Is there spectral (FFT/DCT) structure to exploit? Energy captured by the top 10% / 25% DCT coefficients,
# real data vs the same data with the axis randomly shuffled (shuffle destroys any ordering-based structure).
import numpy as np, gemma
from scipy.fft import dct
rng = np.random.default_rng(0)
def compaction(M, axis):
    C = dct(M, axis=axis, norm='ortho') ** 2
    C = np.sort(C, axis=axis)[::-1] if axis == 0 else -np.sort(-C, axis=axis)
    tot = C.sum(axis=axis)
    n = M.shape[axis]
    take = lambda f: (np.take(C, range(int(n * f)), axis=axis).sum(axis=axis) / tot).mean()
    return take(0.10), take(0.25)
def report(name, M, axis):
    r = compaction(M, axis)
    Ms = np.take(M, rng.permutation(M.shape[axis]), axis=axis)
    s = compaction(Ms, axis)
    print(f'{name:44s} top10%={r[0]*100:5.1f}%  top25%={r[1]*100:5.1f}%   | shuffled: {s[0]*100:5.1f}% {s[1]*100:5.1f}%')
print('-- weights, along their input (hidden-dim) axis --')
for n in ('blk.3.attn_q.weight', 'blk.3.ffn_gate.weight', 'blk.3.ffn_down.weight'):
    report(n, gemma.deq(n)[:512], 1)
E = gemma.deq('token_embd.weight')[rng.choice(262144, 4096, replace=False)]
report('token_embd (4096 random rows)', E, 1)
print('-- hidden states --')
Hs = np.load('g_hidden.npy')                     # [178 tokens, 640 channels]
report('final hidden, along channels', Hs, 1)
report('final hidden, along TIME (per channel)', Hs.T.copy(), 1)
print('-- reference: a smooth signal (what FFT compression needs) --')
t = np.linspace(0, 1, 640); S = np.stack([np.sin(2*np.pi*(3+k%7)*t) + 0.1*rng.standard_normal(640) for k in range(64)])
report('noisy sinusoids', S, 1)
