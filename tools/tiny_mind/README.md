# tiny_mind: the orb's own little mind

A ~30M-parameter model trained from scratch to be the orb's "little self" (`docs/ONBOARDING.md`,
Act 3): one playful sentence at a time, opening with a `[feeling]` tag, plus a few tool tokens
(`<become:mira>`, `<become:kai>`, `<confirm:seven>`, `<replay>`). Every contender maps onto an
architecture llama.cpp already runs (Qwen3-style attention blocks, LFM2 short-conv blocks), so the
winner runs in the app's existing engine as a GGUF.

Plan: simple English + dialogue base (SimpleStories, SODA, TinyDialogues), then the orb's voice
(DeepSeek one-liners in `lines/`, prompt in `deepseek_prompt.md`), then export to GGUF and race it
against the off-the-shelf little selves. Why this architecture, data and size: `RESEARCH.md`.

## Run (CPU is fine: bf16 autocast uses AMX where the CPU has it)

```bash
pip install torch --index-url https://download.pytorch.org/whl/cpu && pip install sentencepiece
pip install pyarrow striprtf
mkdir -p data runs && cd data && H=https://huggingface.co/datasets
curl -L -o ss0.parquet $H/SimpleStories/SimpleStories/resolve/main/data/train-00000-of-00007.parquet
curl -L -o ss1.parquet $H/SimpleStories/SimpleStories/resolve/main/data/train-00001-of-00007.parquet
curl -L -o ss_test.parquet $H/SimpleStories/SimpleStories/resolve/main/data/test-00000-of-00001.parquet
curl -L -o soda.parquet $H/allenai/soda/resolve/main/train.parquet
curl -L -o soda_valid.parquet $H/allenai/soda/resolve/main/valid.parquet
curl -L -o td.txt $H/styfeng/TinyDialogues/resolve/main/tinydialogue_train_ordered.txt
curl -L -o td_valid.txt $H/styfeng/TinyDialogues/resolve/main/tinydialogue_val_ordered.txt
cd .. && python3 orb_lines.py lines/*.md                    # check DeepSeek batches -> data/orb_lines.jsonl
python3 prepare.py                                          # 4k SentencePiece BPE + uint16 token files
python3 -W ignore train.py hybrid19 --minutes 480 --resume  # the 8 h base run; --resume after any stop
```

## Measured (4-core Xeon with AMX, 16 GB, no GPU; 2026-09-29)

- 29M transformer, fp32: ~2,000 tok/s; bf16 autocast: ~4,900-5,300 tok/s (2.4x); `torch.compile`: no gain.
- With Muon + QK-norm (train.py), 30 s smoke test: classic 3,921 tok/s, looped 4,477, deepthin 3,252,
  hybrid 4,818. The 20-min race: hybrid won (val 1.811 vs classic 1.839), see `RESEARCH.md`.
- `hybrid19` (18.5M) on the mix: ~6,700 tok/s. Tokenizer: 4.05 chars/token on stories, 3.68 on SODA;
  `[`, feeling words and the role markers are single tokens.
- First DeepSeek batch: 1,263 of 2,100 rows kept (745 exact duplicates: DeepSeek repeats after ~200 rows).
