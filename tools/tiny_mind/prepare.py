# Train the shared tokenizer and encode the English base corpus into uint16 token files.
import sentencepiece as spm, numpy as np, random, sys, os
D = 'data'
SPECIAL = ['<|user|>', '<|orb|>', '<|state|>', '<become:mira>', '<become:kai>', '<confirm:seven>', '<replay>']

def stories(path):
    return [s.strip() for s in open(path, encoding='utf-8').read().split('<|endoftext|>') if s.strip()]

train, valid = stories(f'{D}/ts_train.txt')[:-1], stories(f'{D}/ts_valid.txt')  # last train story is cut by the byte range
random.seed(0)
with open(f'{D}/spm_input.txt', 'w') as f:
    for s in random.sample(train, 40000):
        f.write(s.replace('\n', ' ') + '\n')
spm.SentencePieceTrainer.train(
    input=f'{D}/spm_input.txt', model_prefix=f'{D}/orb', model_type='bpe', vocab_size=4096,
    byte_fallback=True, split_digits=True, normalization_rule_name='identity',
    remove_extra_whitespaces=False, character_coverage=0.9999, user_defined_symbols=SPECIAL,
    unk_id=0, bos_id=1, eos_id=2, pad_id=-1, num_threads=4)
sp = spm.SentencePieceProcessor(model_file=f'{D}/orb.model')
for name, docs in (('train', train), ('valid', valid)):
    ids = sp.encode(docs, num_threads=4)
    flat = np.fromiter((t for d in ids for t in [1] + d + [2]), dtype=np.uint16)
    flat.tofile(f'{D}/{name}.bin')
    chars = sum(map(len, docs))
    print(f'{name}: {len(docs)} stories, {len(flat)/1e6:.1f}M tokens, {chars/len(flat):.2f} chars/token')
print(sp.encode('[curious] ohh, you came back! <become:kai>', out_type=str))
