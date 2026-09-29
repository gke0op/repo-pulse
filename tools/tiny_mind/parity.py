# Prove a GGUF export matches PyTorch: same token ids for the app's prompt format, same greedy continuation.
# usage: python3 parity.py path/to/llama.cpp model.gguf weights.pt [arch]   (needs llama-simple and llama-tokenize built)
import re, sys, subprocess, torch, sentencepiece as spm
sys.path.insert(0, '.'); from model import build
sp = spm.SentencePieceProcessor(model_file='data/orb.model')
def encode(text):  # llama.cpp's SPM rule: special tokens whole, each text piece gets its own leading ▁
    ids = [1]
    for part in re.split(r'(<\|[a-z]+\|>|<become:[a-z]+>|<confirm:seven>|<replay>)', text):
        if part: ids += [sp.piece_to_id(part)] if part.startswith('<') and sp.piece_to_id(part) != 0 else sp.encode(part)
    return ids
L, G = sys.argv[1], sys.argv[2]
m = build(sys.argv[4] if len(sys.argv) > 4 else 'hybrid19'); sd = torch.load(sys.argv[3], weights_only=False); sd = sd.get('model', sd); m.load_state_dict(sd); m.eval()
for P in ['<|state|>little self, big brain 40%, chat<|user|>hi! what are you?<|orb|>',
          '<|state|>little self, big brain 7%, touch<|user|>[poke]<|orb|>', 'Once upon a time, a little']:
    ids = encode(P)
    out = subprocess.run([f'{L}/build/bin/llama-tokenize', '-m', G, '-p', P, '--ids', '--log-disable'], capture_output=True, text=True).stdout.strip().splitlines()[-1]
    print('tokens match:', eval(out) == ids)
    x = ids[:]
    with torch.no_grad():
        for _ in range(24):
            x.append(m(torch.tensor([x]))[0, -1].argmax().item())
            if x[-1] == 2: break
    py = sp.decode(x[len(ids):])
    cc = subprocess.run([f'{L}/build/bin/llama-simple', '-m', G, '-n', '24', P], capture_output=True, text=True).stdout
    cc = cc.split('<|orb|>')[-1] if '<|orb|>' in P else cc.split(P)[-1]
    print(' torch:', repr(py)); print(' llama:', repr(cc.strip()[:len(py) + 20]))
