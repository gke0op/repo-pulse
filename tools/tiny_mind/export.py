# Export a trained orb model to a Hugging Face-style LFM2 folder and then to GGUF for llama.cpp.
# usage: python3 export.py runs/voice.pt out_dir [--llama path/to/llama.cpp] [--arch hybrid19]
# Our blocks are LFM2's (see model.py), so only names change; the tokenizer stays SentencePiece
# (GGUF vocab type "llama"), which the lfm2 converter doesn't pick by default, hence the patch below.
import argparse, json, os, shutil, subprocess, sys, torch
from safetensors.torch import save_file
from model import ARCHS

ap = argparse.ArgumentParser()
ap.add_argument('weights'); ap.add_argument('out'); ap.add_argument('--arch', default='hybrid19')
ap.add_argument('--llama', default='llama.cpp'); ap.add_argument('--outtype', default='f16')
a = ap.parse_args()
cfg = ARCHS[a.arch]; assert cfg.get('loops', 1) == 1
sd = torch.load(a.weights, weights_only=False); sd = sd.get('model', sd)
os.makedirs(a.out, exist_ok=True)

names = {'emb.weight': 'model.embed_tokens.weight', 'norm.weight': 'model.embedding_norm.weight'}
for i, kind in enumerate(cfg['layers']):
    p, q = f'blocks.{i}.', f'model.layers.{i}.'
    names |= {p + 'op_norm.weight': q + 'operator_norm.weight', p + 'ffn_norm.weight': q + 'ffn_norm.weight',
              p + 'gate.weight': q + 'feed_forward.w1.weight', p + 'up.weight': q + 'feed_forward.w3.weight',
              p + 'down.weight': q + 'feed_forward.w2.weight'}
    if kind == 'attn':
        for s, t in (('q_proj', 'q_proj'), ('k_proj', 'k_proj'), ('v_proj', 'v_proj'), ('o_proj', 'out_proj'),
                     ('q_norm', 'q_layernorm'), ('k_norm', 'k_layernorm')):
            names[f'{p}op.{s}.weight'] = f'{q}self_attn.{t}.weight'
    else:
        for s in ('in_proj', 'conv', 'out_proj'):
            names[f'{p}op.{s}.weight'] = f'{q}conv.{s}.weight'
assert set(names) == set(sd), set(sd) ^ set(names)
save_file({names[k]: v.float().contiguous() for k, v in sd.items()}, f'{a.out}/model.safetensors')

json.dump(dict(
    architectures=['Lfm2ForCausalLM'], model_type='lfm2', vocab_size=4096, hidden_size=cfg['D'],
    num_hidden_layers=len(cfg['layers']), num_attention_heads=cfg['H'], num_key_value_heads=cfg['KV'],
    layer_types=['full_attention' if k == 'attn' else 'conv' for k in cfg['layers']],
    block_ff_dim=cfg['F'], intermediate_size=cfg['F'], block_auto_adjust_ff_dim=False,
    block_ffn_dim_multiplier=1.0, block_multiple_of=256, conv_L_cache=3, conv_bias=False,
    norm_eps=1e-6, rope_theta=10000.0, max_position_embeddings=256, tie_embedding=True,
    tie_word_embeddings=True, bos_token_id=1, eos_token_id=2, pad_token_id=2, torch_dtype='float32',
), open(f'{a.out}/config.json', 'w'), indent=1)
json.dump(dict(add_bos_token=True, add_eos_token=False, bos_token='<s>', eos_token='</s>', unk_token='<unk>'),
          open(f'{a.out}/tokenizer_config.json', 'w'), indent=1)
shutil.copy('data/orb.model', f'{a.out}/tokenizer.model')

conv = f'''
import sys; sys.argv = ["convert_hf_to_gguf.py", "{a.out}", "--outfile", "{a.out}/orb-{a.arch}-{a.outtype}.gguf", "--outtype", "{a.outtype}"]
sys.path.insert(0, "{a.llama}")
import conversion.lfm2 as m, gguf
def set_vocab(self):  # SentencePiece vocab, with our <|...|> and tool tokens matched whole (USER_DEFINED)
    tokens, scores, types = self._create_vocab_sentencepiece()
    types = [gguf.TokenType.USER_DEFINED if t.startswith(b"<") and t.endswith(b">") and i > 2 and not t.startswith(b"<0x")
             else ty for i, (t, ty) in enumerate(zip(tokens, types))]
    w = self.gguf_writer
    w.add_tokenizer_model("llama"); w.add_tokenizer_pre("default")
    w.add_token_list(tokens); w.add_token_scores(scores); w.add_token_types(types)
    gguf.SpecialVocab(self.dir_model, n_vocab=len(tokens)).add_to_gguf(w)
m.LFM2Model.set_vocab = set_vocab
import runpy; runpy.run_path("{a.llama}/convert_hf_to_gguf.py", run_name="__main__")
'''
sys.exit(subprocess.call([sys.executable, '-c', conv]))
