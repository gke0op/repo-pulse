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
python3 -W ignore voice.py runs/hybrid19.pt                 # the orb's voice -> runs/voice.pt, prints sample replies
pip install transformers llama.cpp/gguf-py                  # llama.cpp checkout with llama-simple, llama-tokenize built
python3 export.py runs/voice.pt runs/export --llama llama.cpp   # -> runs/export/orb-hybrid19-f16.gguf (37 MB)
python3 parity.py llama.cpp runs/export/orb-hybrid19-f16.gguf runs/voice.pt   # same ids, same greedy text
```

The app's prompt is plain text with the markers (no spaces after them):
`<|state|>little self, big brain 42%, chat<|user|>are you alive?<|orb|>` and the reply comes back as
`[curious] alive enough to wonder about it.` plus an optional tool token, then end of text.
llama.cpp tokenizes this exactly like training does (`voice.encode`; checked by `parity.py`).

## Measured (4-core Xeon with AMX, 16 GB, no GPU; 2026-09-29)

- 29M transformer, fp32: ~2,000 tok/s; bf16 autocast: ~4,900-5,300 tok/s (2.4x); `torch.compile`: no gain.
- With Muon + QK-norm (train.py), 30 s smoke test: classic 3,921 tok/s, looped 4,477, deepthin 3,252,
  hybrid 4,818. The 20-min race: hybrid won (val 1.811 vs classic 1.839), see `RESEARCH.md`.
- `hybrid19` (18.5M) on the mix: ~6,700 tok/s. Tokenizer: 4.05 chars/token on stories, 3.68 on SODA;
  `[`, feeling words and the role markers are single tokens.
- GGUF export (llama.cpp `lfm2` arch, SentencePiece vocab with the markers as USER_DEFINED): greedy output
  of the f16 GGUF matches PyTorch fp32 token for token on 3 prompts (2026-09-29, llama.cpp 6d78fb0).
- First DeepSeek batch: 1,263 of 2,100 rows kept (745 exact duplicates: DeepSeek repeats after ~200 rows).
