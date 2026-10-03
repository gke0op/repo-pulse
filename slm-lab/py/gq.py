# Gemma 4-bit body study: sensitivity per tensor class + activation-aware Q4, scored vs Q8 NumPy reference
import numpy as np, sys, gemma, awq_core as A
EVAL = [int(t) for t in open('geval_ids.txt').read().split(',')]
CAL = [int(t) for t in open('gcalib.txt').read().split(',')]
E, Ls, on = gemma.load()

# activation stats (E[x^2] per input channel) on calibration text, via recording wrappers
stats = {}
class Rec:
    def __init__(s, W, key): s.W, s.key = W, key
    def __matmul__(s, x):
        a = stats.setdefault(s.key, [0, 0]); a[0] = a[0] + x.astype(np.float64) ** 2; a[1] += 1
        return s.W @ x
    @property
    def T(s): return s.W.T
LsR = [{k: (Rec(w[k], f'{i}.{k}') if k in gemma.QKEYS else w[k]) for k in w} for i, w in enumerate(Ls)]
gemma.run(CAL, E, LsR, on)
imat = {k: (v[0] / v[1]).astype(np.float32) for k, v in stats.items()}
print('calibrated', len(imat), 'tensors on', len(CAL), 'tokens', flush=True)

base = gemma.run(EVAL, E, Ls, on)
def score(name, lg):
    lp = lambda z: z - np.log(np.exp(z - z.max(-1, keepdims=True)).sum(-1, keepdims=True)) - z.max(-1, keepdims=True)
    pb, pq = lp(base), lp(lg)
    kl = (np.exp(pb) * (pb - pq)).sum(-1)
    print(f'{name:34s} top1={np.mean(lg.argmax(-1) == base.argmax(-1))*100:5.1f}%  KL mean={kl.mean():.4f} p99={np.quantile(kl, .99):.3f}', flush=True)
def run_with(fn):
    L2 = [{k: (fn(f'{i}.{k}', w[k]) if k in gemma.QKEYS else w[k]) for k in w} for i, w in enumerate(Ls)]
    return gemma.run(EVAL, E, L2, on)

mode = sys.argv[1]
if mode == 'sens':
    for cls in gemma.QKEYS:
        score('Q4-RTN only ' + cls, run_with(lambda n, W, c=cls: A.q4_rtn(W) if n.endswith(c) else W))
elif mode == 'all':
    score('all body Q4 RTN', run_with(lambda n, W: A.q4_rtn(W)))
    score('all body Q4 imatrix search', run_with(lambda n, W: A.q4_wsearch(W, imat[n])))
    for al in (0.15, 0.25, 0.35):
        score(f'all body Q4 AWQ a={al}', run_with(lambda n, W, al=al: A.awq_q(W, imat[n], al)))
elif mode == 'mix':
    al = float(sys.argv[2]); keep = sys.argv[3].split(',') if len(sys.argv) > 3 else []
    score(f'Q4 AWQ a={al} keep Q8: {keep}', run_with(lambda n, W: W if n.split('.')[1] in keep else A.awq_q(W, imat[n], al)))
