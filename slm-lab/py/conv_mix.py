# Mixed recipe -> engine file "smol_mix.sun". Q8 tensors: as convert.py. Q4 tensors (AWQ a=0.25 + imatrix-weighted
# scale search): nibble-pair packed codes (rows*K/2 B), f16 scales (rows*K/32), f32 inv_s (K). Each section 64B padded.
import numpy as np, ref
from convert import q8, f32

Q4SET = ('attn_q', 'attn_output', 'ffn_gate', 'ffn_up')
ALPHA = 0.25
imat = dict(np.load('imatrix.npz'))

def deq8(name):
    q, d = q8(name)
    return (q.astype(np.float32).reshape(q.shape[0], -1, 32) * d.astype(np.float32)[:, :, None]).reshape(q.shape[0], -1)

def q4_codes(W, aw_row):
    rows, K = W.shape
    b = W.reshape(-1, 32)
    aw = np.broadcast_to(aw_row.reshape(-1, 32), (rows, K // 32, 32)).reshape(-1, 32)
    mx = b[np.arange(len(b)), np.abs(b).argmax(1)]
    bq = bd = be = None
    for f in np.linspace(-6.5, -9.5, 31):
        d = (mx / f).astype(np.float16)
        df = d.astype(np.float32)[:, None]
        inv = np.where(df != 0, 1 / df, 0)
        q = np.clip(np.round(b * inv) + 8, 0, 15)
        e = (aw * ((q - 8) * df - b) ** 2).sum(1)
        if bq is None: bq, bd, be = q, d, e
        else:
            m = e < be; bq[m] = q[m]; bd[m] = d[m]; be[m] = e[m]
    return bq.astype(np.uint8).reshape(rows, K), bd.reshape(rows, K // 32)

def q4_tensor(name):
    W = deq8(name)
    a = imat[name]
    s = ((a / a.mean()) ** (ALPHA / 2)).astype(np.float32)
    codes, d = q4_codes(W * s[None, :], a / (s * s))
    rows, K = W.shape
    c = codes.reshape(rows, K // 64, 2, 32)
    packed = (c[:, :, 0, :] | (c[:, :, 1, :] << 4)).astype(np.uint8).reshape(rows, K // 2)
    weff = ((codes.astype(np.float32).reshape(rows, -1, 32) - 8) * d.astype(np.float32)[:, :, None]).reshape(rows, K) / s[None, :]
    return packed, d, (1.0 / s).astype(np.float32), weff

if __name__ == '__main__':
    out = open('smol_mix.sun', 'wb')
    pad = lambda: out.write(b'\0' * (-out.tell() % 64))
    eff = {}
    def wq(name):
        if name.split('.')[-2] in Q4SET:
            packed, d, invs, weff = q4_tensor(name)
            out.write(packed.tobytes()); pad(); out.write(d.tobytes()); pad(); out.write(invs.tobytes()); pad()
            eff[name] = weff
        else:
            q, d = q8(name); out.write(q.tobytes()); pad(); out.write(d.tobytes()); pad()
    def wf(name): out.write(f32(name).tobytes()); pad()
    wq('token_embd.weight')
    for i in range(30):
        p = f'blk.{i}.'
        wf(p + 'attn_norm.weight')
        for n in ('attn_q', 'attn_k', 'attn_v', 'attn_output'): wq(p + n + '.weight')
        wf(p + 'ffn_norm.weight')
        for n in ('ffn_gate', 'ffn_up', 'ffn_down'): wq(p + n + '.weight')
    wf('output_norm.weight')
    print('bytes', out.tell(), flush=True)
    # numpy logits with the exact effective weights written to the file
    ref.layers = [{k: eff.get(f'blk.{i}.{k}.weight', w[k]) for k in w} for i, w in enumerate(ref.layers)]
    lg = ref.run([1, 4093, 198, 1780, 314, 260, 3575, 282, 4649, 47, 2, 198, 1, 520, 9531, 198])
    np.save('ref_mix_logits.npy', lg.astype(np.float32))
    print('ref_mix argmax:', lg.argmax(-1).tolist())
