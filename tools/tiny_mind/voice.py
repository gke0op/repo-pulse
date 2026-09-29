# Teach the base model the orb's voice: fine-tune on the checked DeepSeek lines (data/orb_lines.jsonl),
# loss only on the orb's reply (feeling tag, sentence, tool token, end), with base text replayed so
# English isn't forgotten. Prints held-out loss per epoch and sample replies for a fixed set of moments.
import argparse, json, random, re, numpy as np, torch, torch.nn.functional as F, sentencepiece as spm
from model import build

ap = argparse.ArgumentParser()
ap.add_argument('base', help='base weights: runs/hybrid19.pt or a .ckpt'); ap.add_argument('--arch', default='hybrid19')
ap.add_argument('--epochs', type=int, default=6); ap.add_argument('--batch', type=int, default=32)
ap.add_argument('--muon_lr', type=float, default=0.005); ap.add_argument('--adam_lr', type=float, default=1e-3)
ap.add_argument('--threads', type=int, default=4); ap.add_argument('--out', default='runs/voice.pt')
a = ap.parse_args()
torch.manual_seed(0); torch.set_num_threads(a.threads); random.seed(0)
sp = spm.SentencePieceProcessor(model_file='data/orb.model')
ORB = sp.piece_to_id('<|orb|>')

def prompt(moment, user, pct):  # the text the app sends: no spaces after the markers
    return f"<|state|>little self, big brain {pct}%, {moment}" + (f"<|user|>{user}" if user else '') + '<|orb|>'
def encode(text):  # exactly llama.cpp's SentencePiece rule: markers whole, each text piece gets its own ▁
    ids = [1]
    for part in re.split(r'(<\|[a-z]+\|>|<become:[a-z]+>|<confirm:seven>|<replay>)', text):
        if part: ids += [sp.piece_to_id(part)] if part.startswith('<') and sp.piece_to_id(part) != 0 else sp.encode(part)
    return ids
def example(r):
    p = encode(prompt(r['moment'], r['user'], random.randint(0, 99)))
    reply = encode(f"[{r['feeling']}] {r['orb']}" + (f"<{r['action']}>" if r['action'] else ''))[1:] + [2]
    return p + reply, len(p)

rows = [json.loads(l) for l in open('data/orb_lines.jsonl')]
random.shuffle(rows)
held = rows[:max(50, len(rows) // 20)]; train = rows[len(held):]
def batches(rs, shuffle):
    rs = rs[:]; random.shuffle(rs) if shuffle else None
    for i in range(0, len(rs), a.batch):
        ex = [example(r) for r in rs[i:i + a.batch]]
        T = max(len(t) for t, _ in ex)
        x = torch.full((len(ex), T), 2); y = torch.full((len(ex), T), -100)
        for j, (t, n) in enumerate(ex):
            x[j, :len(t)] = torch.tensor(t)
            y[j, n - 1:len(t) - 1] = torch.tensor(t[n:])   # predict only the reply
        yield x, y

base = np.memmap('data/soda.train.bin', dtype=np.uint16, mode='r')
brng = np.random.default_rng(0)
def replay(n=8, T=256):
    ix = brng.integers(0, len(base) - T - 1, n)
    t = torch.from_numpy(np.stack([base[i:i + T + 1] for i in ix]).astype(np.int64))
    return t[:, :-1], t[:, 1:]

model = build(a.arch)
sd = torch.load(a.base, weights_only=False); model.load_state_dict(sd.get('model', sd))
hidden = [p for n, p in model.named_parameters() if p.ndim == 2 and n != 'emb.weight']
other = [p for n, p in model.named_parameters() if not (p.ndim == 2 and n != 'emb.weight')]
opts = [torch.optim.Muon(hidden, lr=a.muon_lr, weight_decay=0.0),
        torch.optim.AdamW(other, lr=a.adam_lr, betas=(0.9, 0.95), weight_decay=0.0)]

def loss_of(x, y):
    with torch.autocast('cpu', dtype=torch.bfloat16):
        return F.cross_entropy(model(x).float().view(-1, 4096), y.reshape(-1), ignore_index=-100)
@torch.no_grad()
def held_loss():
    model.eval(); random.seed(1); ls = [loss_of(x, y).item() for x, y in batches(held, False)]; model.train()
    return sum(ls) / len(ls)

print(f'{len(train)} train / {len(held)} held-out lines; held-out loss before: {held_loss():.3f}', flush=True)
best = 9e9
for ep in range(1, a.epochs + 1):
    for x, y in batches(train, True):
        loss = loss_of(x, y) + 0.3 * loss_of(*replay())
        for o in opts: o.zero_grad(set_to_none=True)
        loss.backward(); torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
        for o in opts: o.step()
    h = held_loss(); print(f'epoch {ep}: held-out {h:.3f}', flush=True)
    if h < best: best = h; torch.save(model.state_dict(), a.out)
model.load_state_dict(torch.load(a.out))

@torch.no_grad()
def reply(moment, user, pct=40, temp=0.8, k=40, seed=0):
    g = torch.Generator().manual_seed(seed); ids = encode(prompt(moment, user, pct)); n0 = len(ids)
    model.eval()
    for _ in range(40):
        with torch.autocast('cpu', dtype=torch.bfloat16):
            logits = model(torch.tensor([ids]))[0, -1].float() / temp
        v, i = logits.topk(k); nxt = i[torch.multinomial(F.softmax(v, -1), 1, generator=g)].item()
        if nxt == 2: break
        ids.append(nxt)
    return sp.decode(ids[n0:])
for moment, user in [('chat', 'hi! what are you?'), ('chat', 'i had a really bad day.'), ('chat', 'do you dream?'),
                     ('chat', 'my cat knocked my coffee over'), ('chat', 'what should i call you?'),
                     ('touch', '[poke]'), ('idle', '[silent for a while]'), ('return', '[back after two days]'),
                     ('tour', ''), ('self', ''), ('become', 'can you turn into unit seven?'), ('become', 'be mira please')]:
    print(f'{moment:6} | {user:32} | {reply(moment, user)}')
