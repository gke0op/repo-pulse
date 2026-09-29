# Score the orb: sample N replies per prompt and check format, one sentence, and tool choice.
# usage: python3 evaluate.py runs/voice.pt [--n 5]
import re, sys, json, collections, torch, torch.nn.functional as F, sentencepiece as spm
from model import build
w = sys.argv[1]; N = int(sys.argv[sys.argv.index('--n') + 1]) if '--n' in sys.argv else 5
sp = spm.SentencePieceProcessor(model_file='data/orb.model')
src = open('voice.py').read(); exec(src[src.index('def prompt'):src.index('def example')])
m = build('hybrid19'); m.load_state_dict(torch.load(w)); m.eval(); torch.set_num_threads(4)
FEEL = 'calm|happy|sad|angry|surprised|curious|tender'
CASES = [('chat', 'hi! what are you?', ''), ('chat', 'i had a really bad day.', ''), ('chat', 'are you alive?', ''),
         ('chat', 'my cat knocked my coffee over', ''), ('chat', "you're kind of annoying", ''), ('touch', '[poke]', ''),
         ('return', '[back after two days]', ''), ('tour', '', ''), ('become', 'be mira please', 'become:mira'),
         ('become', 'can you turn into kai?', 'become:kai'), ('become', 'i want unit seven', 'confirm:seven'),
         ('become', 'show me how you woke up', 'replay')]
@torch.no_grad()
def reply(moment, user, seed):
    g = torch.Generator().manual_seed(seed); ids = encode(prompt(moment, user, 50)); n0 = len(ids)
    for _ in range(40):
        with torch.autocast('cpu', dtype=torch.bfloat16):
            logits = m(torch.tensor([ids]))[0, -1].float() / 0.8
        v, i = logits.topk(40); nxt = i[torch.multinomial(F.softmax(v, -1), 1, generator=g)].item()
        if nxt == 2: break
        ids.append(nxt)
    return sp.decode(ids[n0:]).strip()
score = collections.Counter(); total = 0
for moment, user, tool in CASES:
    outs = [reply(moment, user, s) for s in range(N)]
    for o in outs:
        total += 1
        body = re.sub(r'<[^>]+>$', '', o).strip()
        score['tag'] += bool(re.match(rf'\[({FEEL})\] ', o))
        score['one sentence'] += len(re.split(r'(?<=[.!?…])\s+(?=\S)', body)) == 1 and bool(re.search(r'[.!?…]$', body))
        got = re.findall(r'<(become:\w+|confirm:seven|replay)>', o)
        score['right tool'] += (got == [tool]) if tool else (got == [])
    print(f'{moment:6} | {user[:28]:28} | ' + ' || '.join(outs[:3]))
print(json.dumps({k: f'{v}/{total}' for k, v in score.items()}))
