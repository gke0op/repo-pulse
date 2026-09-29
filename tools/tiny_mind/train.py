# Train one contender for a fixed wall-clock budget (training time only; evals pause the clock).
# bf16 autocast on AMX, Muon for hidden 2D matrices, AdamW for embeddings/norms/conv, WSD schedule by time.
import argparse, json, time, math, numpy as np, torch, torch.nn.functional as F, sentencepiece as spm
from model import build

ap = argparse.ArgumentParser()
ap.add_argument('arch'); ap.add_argument('--minutes', type=float, default=20)
ap.add_argument('--batch', type=int, default=32); ap.add_argument('--seq', type=int, default=256)
ap.add_argument('--muon_lr', type=float, default=0.02); ap.add_argument('--adam_lr', type=float, default=3e-3)
ap.add_argument('--eval_every', type=float, default=4, help='minutes of training between evals')
ap.add_argument('--out', default='runs')
a = ap.parse_args()
torch.manual_seed(0); torch.set_num_threads(4)

train = np.memmap('data/train.bin', dtype=np.uint16, mode='r')
valid = np.memmap('data/valid.bin', dtype=np.uint16, mode='r')
def batch(data, rng, n):
    ix = rng.integers(0, len(data) - a.seq - 1, n)
    x = torch.from_numpy(np.stack([data[i:i + a.seq + 1] for i in ix]).astype(np.int64))
    return x[:, :-1], x[:, 1:]
vrng = np.random.default_rng(1234)
val_batches = [batch(valid, vrng, a.batch) for _ in range(48)]   # fixed: ~393k tokens

model = build(a.arch, T=a.seq)
hidden = [p for n, p in model.named_parameters() if p.ndim == 2 and n != 'emb.weight']
other = [p for n, p in model.named_parameters() if not (p.ndim == 2 and n != 'emb.weight')]
opts = [torch.optim.Muon(hidden, lr=a.muon_lr, weight_decay=0.0),
        torch.optim.AdamW(other, lr=a.adam_lr, betas=(0.9, 0.95), weight_decay=0.0)]
base = [a.muon_lr, a.adam_lr]
def lr_mult(frac):  # warmup 3%, stable, linear decay over the last 30%
    return min(frac / 0.03, 1.0, (1.0 - frac) / 0.30 + 0.02)

@torch.no_grad()
def evaluate(n=48):
    model.eval(); tot = 0.0
    for x, y in val_batches[:n]:
        with torch.autocast('cpu', dtype=torch.bfloat16):
            tot += F.cross_entropy(model(x).float().view(-1, 4096), y.reshape(-1)).item()
    model.train(); return tot / n

rng = np.random.default_rng(0)
budget = a.minutes * 60; trained = 0.0; step = 0; tokens = 0; next_eval = a.eval_every * 60
log = open(f'{a.out}/{a.arch}.jsonl', 'w'); losses = []
while trained < budget:
    t0 = time.time()
    for o, b in zip(opts, base):
        for g in o.param_groups: g['lr'] = b * lr_mult(trained / budget)
    x, y = batch(train, rng, a.batch)
    with torch.autocast('cpu', dtype=torch.bfloat16):
        loss = F.cross_entropy(model(x).float().view(-1, 4096), y.reshape(-1))
    for o in opts: o.zero_grad(set_to_none=True)
    loss.backward()
    torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
    for o in opts: o.step()
    trained += time.time() - t0; step += 1; tokens += x.numel(); losses.append(loss.item())
    if trained >= next_eval or trained >= budget:
        rec = dict(arch=a.arch, step=step, minutes=round(trained / 60, 2), tokens=tokens,
                   tok_s=round(tokens / trained), train_loss=round(sum(losses[-20:]) / len(losses[-20:]), 4),
                   val_loss=round(evaluate(48 if trained >= budget else 16), 4))
        print(json.dumps(rec), flush=True); log.write(json.dumps(rec) + '\n'); log.flush()
        next_eval += a.eval_every * 60

torch.save(model.state_dict(), f'{a.out}/{a.arch}.pt')
sp = spm.SentencePieceProcessor(model_file='data/orb.model')
@torch.no_grad()
def sample(prompt, n=60, temp=0.8, k=40, seed=0):
    g = torch.Generator().manual_seed(seed); ids = [1] + sp.encode(prompt)
    model.eval()
    for _ in range(n):
        with torch.autocast('cpu', dtype=torch.bfloat16):
            logits = model(torch.tensor([ids[-a.seq:]]))[0, -1].float() / temp
        v, i = logits.topk(k); nxt = i[torch.multinomial(F.softmax(v, -1), 1, generator=g)].item()
        if nxt == 2: break
        ids.append(nxt)
    return sp.decode(ids[1:])
with open(f'{a.out}/{a.arch}.samples.txt', 'w') as f:
    for p in ['Once upon a time, a little', 'The orb glowed and said,', '"Are you alive?" asked Lily.']:
        s = sample(p); print('>>', s.replace('\n', ' ')); f.write(s + '\n\n')
