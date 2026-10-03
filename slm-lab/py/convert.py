# GGUF Q8_0 -> "sun" engine format: per Q8 tensor: int8 weights (rows*K, 64B aligned) then f16 scales (rows*K/32, 64B aligned)
import sys, numpy as np
sys.path.insert(0, 'llama.cpp/gguf-py')
import gguf

r = gguf.GGUFReader(sys.argv[1] if __name__ == '__main__' else 'q.gguf')
T = {t.name: t for t in r.tensors}
L = 30

def q8(name):
    t = T[name]
    raw = np.asarray(t.data, dtype=np.uint8)
    rows = int(t.shape[1]); K = int(t.shape[0])
    blk = raw.reshape(rows, K // 32, 34)
    d = blk[:, :, :2].copy().view(np.float16).reshape(rows, K // 32)
    q = blk[:, :, 2:].copy().view(np.int8).reshape(rows, K)
    return q, d

def f32(name):
    return np.asarray(T[name].data, dtype=np.float32).reshape(-1)

if __name__ == '__main__':
    out = open(sys.argv[2], 'wb')
    def pad():
        out.write(b'\0' * (-out.tell() % 64))
    def wq(name):
        q, d = q8(name); out.write(q.tobytes()); pad(); out.write(d.tobytes()); pad()
    def wf(name):
        out.write(f32(name).tobytes()); pad()

    wq('token_embd.weight')
    for i in range(L):
        p = f'blk.{i}.'
        wf(p + 'attn_norm.weight')
        for n in ('attn_q', 'attn_k', 'attn_v', 'attn_output'): wq(p + n + '.weight')
        wf(p + 'ffn_norm.weight')
        for n in ('ffn_gate', 'ffn_up', 'ffn_down'): wq(p + n + '.weight')
    wf('output_norm.weight')
    print('bytes', out.tell())
