# tiny_mind: the orb's own little mind

A ~30M-parameter model trained from scratch to be the orb's "little self" (`docs/ONBOARDING.md`,
Act 3): one playful sentence at a time, opening with a `[feeling]` tag, plus a few tool tokens
(`<become:mira>`, `<become:kai>`, `<confirm:seven>`, `<replay>`). Every contender maps onto an
architecture llama.cpp already runs (Qwen3-style attention blocks, LFM2 short-conv blocks), so the
winner runs in the app's existing engine as a GGUF.

Plan: simple English base (TinyStories V2, GPT-4 stories), then the orb's voice (DeepSeek one-liners,
`deepseek_prompt.md`), then export to GGUF and race it against the off-the-shelf little selves.

## Run (CPU is fine: bf16 autocast uses AMX where the CPU has it)

```bash
pip install torch --index-url https://download.pytorch.org/whl/cpu && pip install sentencepiece
mkdir -p data runs && cd data
curl -L -r 0-149999999 -o ts_train.txt https://huggingface.co/datasets/roneneldan/TinyStories/resolve/main/TinyStoriesV2-GPT4-train.txt
curl -L -o ts_valid.txt https://huggingface.co/datasets/roneneldan/TinyStories/resolve/main/TinyStoriesV2-GPT4-valid.txt
cd .. && python3 prepare.py                         # 4k SentencePiece BPE + uint16 token files
python3 -W ignore train.py hybrid --minutes 20      # contenders: classic, looped, deepthin, hybrid
python3 orb_lines.py batch*.md                      # check DeepSeek batches -> data/orb_lines.jsonl
```

## Measured (4-core Xeon with AMX, 16 GB, no GPU; 2026-09-29)

- 29M transformer, fp32: ~2,000 tok/s; bf16 autocast: ~4,900-5,300 tok/s (2.4x); `torch.compile`: no gain.
- With Muon + QK-norm (train.py), 30 s smoke test: classic 3,921 tok/s, looped 4,477, deepthin 3,252,
  hybrid 4,818 (val loss 3.92 vs 4.48-5.10 for the rest: too early to mean much).
- Tokenizer: 3.87 chars/token on stories. `[`/`]` and tag words fall back to bytes until orb lines
  are in the tokenizer's training text (retrain once the DeepSeek batches land).
