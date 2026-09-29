# Contenders for the orb's mind. Every block maps onto a llama.cpp architecture:
# 'attn' blocks are Qwen3-style (RMSNorm, RoPE neox, QK-norm, GQA, SwiGLU, tied embeddings);
# 'conv' blocks are LFM2's double-gated short convolution. Looping = the same blocks run again
# (exported as repeated layers).
import torch, torch.nn as nn, torch.nn.functional as F

ARCHS = {
    'classic':   dict(D=512, H=8, KV=4, F=1536, layers=['attn'] * 8),
    'looped':    dict(D=512, H=8, KV=4, F=1536, layers=['attn'] * 4, loops=2),
    'deepthin':  dict(D=384, H=6, KV=3, F=1024, layers=['attn'] * 16),
    'hybrid':    dict(D=512, H=8, KV=4, F=1536, layers=['conv', 'conv', 'attn', 'conv', 'conv', 'attn', 'conv', 'attn']),
    # race winner at ~19M (compute-optimal for ~8 h here); attention at 2,4,6,8 like LFM2.5-230M
    'hybrid19':  dict(D=384, H=6, KV=2, F=1024, layers=['conv', 'conv', 'attn', 'conv', 'attn', 'conv', 'attn', 'conv', 'attn', 'conv']),
}

def rope_tables(T, hd, base=10000.0):
    inv = 1.0 / base ** (torch.arange(0, hd, 2).float() / hd)
    ang = torch.outer(torch.arange(T).float(), inv)
    ang = torch.cat([ang, ang], -1)
    return ang.cos()[None, None], ang.sin()[None, None]

def rope(x, cos, sin):
    a, b = x.chunk(2, -1)
    return x * cos + torch.cat([-b, a], -1) * sin

class Attn(nn.Module):
    def __init__(s, D, H, KV):
        super().__init__(); s.H, s.KV, s.hd = H, KV, D // H
        s.q_proj = nn.Linear(D, H * s.hd, bias=False); s.k_proj = nn.Linear(D, KV * s.hd, bias=False)
        s.v_proj = nn.Linear(D, KV * s.hd, bias=False); s.o_proj = nn.Linear(H * s.hd, D, bias=False)
        s.q_norm = nn.RMSNorm(s.hd, eps=1e-6); s.k_norm = nn.RMSNorm(s.hd, eps=1e-6)
    def forward(s, x, cos, sin):
        B, T, _ = x.shape
        q = rope(s.q_norm(s.q_proj(x).view(B, T, s.H, s.hd)).transpose(1, 2), cos, sin)
        k = rope(s.k_norm(s.k_proj(x).view(B, T, s.KV, s.hd)).transpose(1, 2), cos, sin)
        v = s.v_proj(x).view(B, T, s.KV, s.hd).transpose(1, 2)
        y = F.scaled_dot_product_attention(q, k, v, is_causal=True, enable_gqa=s.KV < s.H)
        return s.o_proj(y.transpose(1, 2).reshape(B, T, -1))

class ShortConv(nn.Module):  # LFM2: in_proj -> B, C, x; conv(B*x); C*conv; out_proj
    def __init__(s, D, L=3):
        super().__init__()
        s.in_proj = nn.Linear(D, 3 * D, bias=False); s.out_proj = nn.Linear(D, D, bias=False)
        s.conv = nn.Conv1d(D, D, L, groups=D, padding=L - 1, bias=False)
    def forward(s, x, cos=None, sin=None):
        T = x.shape[1]
        b, c, h = s.in_proj(x).transpose(1, 2).chunk(3, dim=1)
        return s.out_proj((c * s.conv(b * h)[..., :T]).transpose(1, 2))

class Block(nn.Module):
    def __init__(s, kind, D, H, KV, F):
        super().__init__()
        s.op_norm = nn.RMSNorm(D, eps=1e-6); s.ffn_norm = nn.RMSNorm(D, eps=1e-6)
        s.op = Attn(D, H, KV) if kind == 'attn' else ShortConv(D)
        s.gate = nn.Linear(D, F, bias=False); s.up = nn.Linear(D, F, bias=False); s.down = nn.Linear(F, D, bias=False)
    def forward(s, x, cos, sin):
        x = x + s.op(s.op_norm(x), cos, sin)
        h = s.ffn_norm(x)
        return x + s.down(F.silu(s.gate(h)) * s.up(h))

class Orb(nn.Module):
    def __init__(s, V, D, H, KV, F, layers, loops=1, T=256):
        super().__init__(); s.loops = loops
        s.emb = nn.Embedding(V, D)
        s.blocks = nn.ModuleList(Block(k, D, H, KV, F) for k in layers)
        s.norm = nn.RMSNorm(D, eps=1e-6)
        cos, sin = rope_tables(T, D // H)
        s.register_buffer('cos', cos, persistent=False); s.register_buffer('sin', sin, persistent=False)
        depth = len(layers) * loops
        for n, p in s.named_parameters():
            if p.ndim >= 2:
                std = 0.02 / (2 * depth) ** 0.5 if n.endswith(('o_proj.weight', 'out_proj.weight', 'down.weight')) else 0.02
                nn.init.normal_(p, 0, std)
    def forward(s, idx):
        T = idx.shape[1]; cos, sin = s.cos[:, :, :T], s.sin[:, :, :T]
        x = s.emb(idx)
        for _ in range(s.loops):
            for b in s.blocks:
                x = b(x, cos, sin)
        return s.norm(x) @ s.emb.weight.T

def build(arch, V=4096, T=256):
    return Orb(V=V, T=T, **ARCHS[arch])
