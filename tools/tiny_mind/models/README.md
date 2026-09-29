# The orb's little mind: trained weights (2026-09-29)

| File | What | Use |
|---|---|---|
| `orb-hybrid19-f16.gguf` | base + voice, for llama.cpp (arch `lfm2`, 18.5M params) | the app / `llama-cli`; parity with PyTorch checked (`parity.py`) |
| `hybrid19-base-bf16.pt` | the 8 h English + dialogue base (no orb voice) | start of every voice retrain: `python3 voice.py models/hybrid19-base-bf16.pt` |
| `voice-bf16.pt` | base + voice (same model as the GGUF) | `evaluate.py`, `export.py` |
| `orb.model` | the 4k SentencePiece tokenizer both need | copy to `data/orb.model` before running the scripts |

Base: 8 h on a 4-core Xeon (AMX, bf16), 189M tokens, val loss stories 1.79 / SODA 1.58 / dialogues 1.27.
Voice: 1,200 checked DeepSeek lines (`lines/orbs-thoughts.md`), held-out loss 2.150.
Scores and known faults: `notes/listen-2026-09-29.md`.

Trained on SimpleStories (MIT), SODA (CC-BY-4.0: **credit "SODA, Kim et al. 2023, Allen AI" in the app**),
TinyDialogues (MIT) and DeepSeek-generated lines (DeepSeek's terms allow training on outputs; tell users
the orb's words are AI-generated).
