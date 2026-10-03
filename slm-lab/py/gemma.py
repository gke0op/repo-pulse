# Gemma-3-270M: GGUF Q8_0 -> engine format + independent NumPy reference
import sys, numpy as np
sys.path.insert(0, 'llama.cpp/gguf-py')
import gguf, os

r = gguf.GGUFReader(os.environ.get('GGUF', 'g8.gguf'))
T = {t.name: t for t in r.tensors}
L, D, H, KVH, HD, F, V = 18, 640, 4, 1, 256, 2048, 262144
EPS, WIN = 1e-6, 512
QKEYS = ('attn_q', 'attn_k', 'attn_v', 'attn_output', 'ffn_gate', 'ffn_up', 'ffn_down')
NKEYS = ('attn_norm', 'attn_q_norm', 'attn_k_norm', 'post_attention_norm', 'ffn_norm', 'post_ffw_norm')

def is_global(l): return l % 6 == 5

def q8(name):
    t = T[name]; raw = np.asarray(t.data, dtype=np.uint8)
    rows, K = int(t.shape[1]), int(t.shape[0])
    blk = raw.reshape(rows, K // 32, 34)
    return blk[:, :, 2:].copy().view(np.int8).reshape(rows, K), blk[:, :, :2].copy().view(np.float16).reshape(rows, K // 32)

def f32(name): return np.asarray(T[name].data, dtype=np.float32).reshape(-1)

def q40(name):  # llama.cpp Q4_0: 18B blocks = f16 d + 16B (lo nibble = w[i], hi nibble = w[i+16]); codes 0..15, value (c-8)*d
    t = T[name]; raw = np.asarray(t.data, dtype=np.uint8)
    rows, K = int(t.shape[1]), int(t.shape[0])
    blk = raw.reshape(rows, K // 32, 18)
    d = blk[:, :, :2].copy().view(np.float16).reshape(rows, K // 32)
    qs = blk[:, :, 2:]
    codes = np.concatenate([qs & 15, qs >> 4], -1).reshape(rows, K)
    return codes, d

def deq(name):
    if T[name].tensor_type.name == 'Q4_0':
        c, d = q40(name)
        return ((c.astype(np.float32) - 8).reshape(c.shape[0], -1, 32) * d.astype(np.float32)[:, :, None]).reshape(c.shape[0], -1)
    q, d = q8(name)
    return (q.astype(np.float32).reshape(q.shape[0], -1, 32) * d.astype(np.float32)[:, :, None]).reshape(q.shape[0], -1)

def write(path):
    out = open(path, 'wb')
    pad = lambda: out.write(b'\0' * (-out.tell() % 64))
    def wq(n): q, d = q8(n); out.write(q.tobytes()); pad(); out.write(d.tobytes()); pad()
    def wf(n): out.write(f32(n).tobytes()); pad()
    wq('token_embd.weight')
    for i in range(L):
        p = f'blk.{i}.'
        for n in NKEYS: wf(p + n + '.weight')
        for n in QKEYS: wq(p + n + '.weight')
    wf('output_norm.weight')
    print('bytes', out.tell())

def ri_bytes(name):
    """Row-interleaved Q8: per 16-row group, per 32-col block: 8x64B chunks (chunk c = rows 0..15 x cols 4c..4c+3, u8=w+128) + 16 f16 scales."""
    q, d = q8(name); rows, K = q.shape; NB = K // 32
    u = (q.astype(np.int16) + 128).astype(np.uint8).reshape(rows // 16, 16, NB, 8, 4)   # g, j, b, c, k
    w = u.transpose(0, 2, 3, 1, 4).reshape(rows // 16, NB, 512)                          # g, b, (c, j, k)
    sc = d.reshape(rows // 16, 16, NB).transpose(0, 2, 1).copy().view(np.uint8).reshape(rows // 16, NB, 32)
    return np.concatenate([w, sc], -1).tobytes()

def ri4_bytes(name):
    """Row-interleaved Q4: per 16-row group, per 32-col block: 4x64B (vector k: lo nibble = cols 8k..8k+3, hi = 8k+4..8k+7; byte j*4+i) + 16 f16 scales."""
    c, d = q40(name); rows, K = c.shape; NB = K // 32
    u = c.astype(np.uint8).reshape(rows // 16, 16, NB, 4, 2, 4)        # g, j, b, k, half, i
    v = (u[:, :, :, :, 0, :] | (u[:, :, :, :, 1, :] << 4))             # g, j, b, k, i
    v = v.transpose(0, 2, 3, 1, 4).reshape(rows // 16, NB, 256)         # g, b, (k, j, i)
    sc = d.reshape(rows // 16, 16, NB).transpose(0, 2, 1).copy().view(np.uint8).reshape(rows // 16, NB, 32)
    return np.concatenate([v, sc], -1).tobytes()

def write_ri(path):
    out = open(path, 'wb')
    pad = lambda: out.write(b'\0' * (-out.tell() % 64))
    def wq(n): out.write(ri4_bytes(n) if T[n].tensor_type.name == 'Q4_0' else ri_bytes(n)); pad()
    def wf(n): out.write(f32(n).tobytes()); pad()
    wq('token_embd.weight')
    for i in range(L):
        p = f'blk.{i}.'
        for n in NKEYS: wf(p + n + '.weight')
        for n in QKEYS: wq(p + n + '.weight')
    wf('output_norm.weight')
    print('bytes', out.tell())

def rms(x, w): return x / np.sqrt(np.mean(x * x, -1, keepdims=True) + EPS) * w
def gelu(x): return 0.5 * x * (1 + np.tanh(0.7978845608028654 * (x + 0.044715 * x ** 3)))
def rope_neox(x, pos, base):  # x [..., HD], rotate halves
    half = HD // 2
    f = pos * base ** (-np.arange(half) * 2 / HD)
    c, s = np.cos(f), np.sin(f)
    a, b = x[..., :half], x[..., half:]
    return np.concatenate([a * c - b * s, a * s + b * c], -1)

def load():
    E = deq('token_embd.weight')
    Ls = []
    for i in range(L):
        p = f'blk.{i}.'
        w = {k: deq(p + k + '.weight') for k in QKEYS}
        w.update({k: f32(p + k + '.weight') for k in NKEYS})
        Ls.append(w)
    return E, Ls, f32('output_norm.weight')

def run(tokens, E, Ls, on):
    Kc = [[] for _ in range(L)]; Vc = [[] for _ in range(L)]
    outs = []
    for pos, t in enumerate(tokens):
        x = E[t] * np.sqrt(D)
        for l, w in enumerate(Ls):
            base = 1e6 if is_global(l) else 1e4
            h = rms(x, w['attn_norm'])
            q = rms((w['attn_q'] @ h).reshape(H, HD), w['attn_q_norm'])
            k = rms((w['attn_k'] @ h).reshape(KVH, HD), w['attn_k_norm'])
            v = (w['attn_v'] @ h).reshape(KVH, HD)
            q = rope_neox(q, pos, base) / 16.0
            k = rope_neox(k, pos, base)
            Kc[l].append(k[0]); Vc[l].append(v[0])
            Ks, Vs = np.stack(Kc[l]), np.stack(Vc[l])
            lo = 0 if is_global(l) else max(0, pos - WIN + 1)
            a = Ks[lo:] @ q.T  # [T,H]
            a = np.exp(a - a.max(0)); a /= a.sum(0)
            o = (a.T @ Vs[lo:]).reshape(-1)
            x = x + rms(w['attn_output'] @ o, w['post_attention_norm'])
            h = rms(x, w['ffn_norm'])
            f = w['ffn_down'] @ (gelu(w['ffn_gate'] @ h) * (w['ffn_up'] @ h))
            x = x + rms(f, w['post_ffw_norm'])
        outs.append(E @ rms(x, on))
    return np.stack(outs)

if __name__ == '__main__':
    if sys.argv[1] == 'convert':
        write('gemma.sun')
    elif sys.argv[1] == 'convert_ri':
        write_ri(sys.argv[2] if len(sys.argv) > 2 else 'gemma_ri.sun')
    else:
        toks = [int(t) for t in sys.argv[2].split(',')]
        E, Ls, on = load()
        lg = run(toks, E, Ls, on)
        np.save(os.environ.get('OUT', 'gref_logits.npy'), lg.astype(np.float32))
        print('ref argmax:', lg.argmax(-1).tolist())
