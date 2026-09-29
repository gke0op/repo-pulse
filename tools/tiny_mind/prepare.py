# Build the base mix and the shared tokenizer, then encode each source into uint16 token files.
# Sources (see RESEARCH.md for licenses): SimpleStories (MIT), SODA (CC-BY-4.0: credit it in the app),
# TinyDialogues (MIT). The orb's own lines only shape the tokenizer here; they are trained on later.
import sentencepiece as spm, numpy as np, pyarrow.parquet as pq, random, json, re
D = 'data'
SPECIAL = ['<|user|>', '<|orb|>', '<|state|>', '<become:mira>', '<become:kai>', '<confirm:seven>', '<replay>']
random.seed(0)

def stories(files):
    return [s.strip() for f in files for s in pq.read_table(f, columns=['story']).column('story').to_pylist() if s and s.strip()]

def soda(f, n=None):
    t = pq.read_table(f, columns=['dialogue', 'speakers']).to_pylist()
    out = []
    for r in t:  # two speakers taking turns -> the chat format the orb will use
        sp = r['speakers']
        if len(set(sp)) != 2 or any(a == b for a, b in zip(sp, sp[1:])):
            continue
        out.append(''.join(('<|user|> ' if i % 2 == 0 else '<|orb|> ') + u.strip() for i, u in enumerate(r['dialogue'])))
    random.shuffle(out)
    return out[:n] if n else out

def tiny_dialogues(f):
    return [re.sub(r'\*\*([^*]+)\*\*:', r'\1:', l.strip().replace('\\n\\n', '\n')).replace('\n ', '\n')
            for l in open(f, encoding='utf-8') if l.strip()]

def orb_row(r, pct):  # the fine-tune format; kept here so the tokenizer learns tags and markers
    user = f"<|user|> {r['user']}" if r['user'] else ''
    tool = f" <{r['action']}>" if r['action'] else ''
    return f"<|state|> little self, big brain {pct}%, {r['moment']}{user}<|orb|> [{r['feeling']}] {r['orb']}{tool}"

src = {
    'stories': (stories([f'{D}/ss0.parquet', f'{D}/ss1.parquet']), stories([f'{D}/ss_test.parquet'])[:20000]),
    'soda': (soda(f'{D}/soda.parquet', 400000), soda(f'{D}/soda_valid.parquet', 10000)),
    'dialogues': (tiny_dialogues(f'{D}/td.txt'), tiny_dialogues(f'{D}/td_valid.txt')[:5000]),
}
orb = [json.loads(l) for l in open(f'{D}/orb_lines.jsonl')]

with open(f'{D}/spm_input.txt', 'w') as f:
    for name, k in (('stories', 30000), ('soda', 20000), ('dialogues', 5000)):
        for s in random.sample(src[name][0], k):
            f.write(s.replace('\n', ' ') + '\n')
    for r in orb * 3:
        f.write(orb_row(r, random.randint(0, 99)) + '\n')
spm.SentencePieceTrainer.train(
    input=f'{D}/spm_input.txt', model_prefix=f'{D}/orb', model_type='bpe', vocab_size=4096,
    byte_fallback=True, split_digits=True, normalization_rule_name='identity',
    remove_extra_whitespaces=False, character_coverage=0.9999, user_defined_symbols=SPECIAL,
    unk_id=0, bos_id=1, eos_id=2, pad_id=-1, num_threads=4, minloglevel=2)
sp = spm.SentencePieceProcessor(model_file=f'{D}/orb.model')

for name, (train, valid) in src.items():
    for split, docs in (('train', train), ('valid', valid)):
        ids = sp.encode(docs, num_threads=4)
        flat = np.fromiter((t for d in ids for t in [1] + d + [2]), dtype=np.uint16)
        flat.tofile(f'{D}/{name}.{split}.bin')
        print(f'{name}.{split}: {len(docs)} docs, {len(flat) / 1e6:.1f}M tokens, {sum(map(len, docs)) / len(flat):.2f} chars/token')
print(sp.encode(orb_row(orb[0], 42), out_type=str))
