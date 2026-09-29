# Why this architecture, data and size (2026-09-29)

Measured here unless marked; "research" = a subagent's web survey of primary sources (links kept).

## The race (measured: 20 min each, same TinyStories-V2 data, 4k tokenizer, Muon + AdamW, bf16 on AMX)

| Contender | Params | tok/s | Val loss at 4 / 8 / 12 / 16 / 20 min |
|---|---|---|---|
| **hybrid** (LFM2-style short conv + 3/8 attention) | 28.6M | **5,856** | 2.559 / 2.259 / 2.110 / 1.970 / **1.811** |
| classic (Qwen3-style attention) | 27.3M | 4,999 | 2.718 / 2.357 / 2.177 / 2.011 / 1.839 |
| looped (4 blocks x 2) | 14.7M | 5,473 | 2.693 / 2.339 / 2.158 / 2.008 / 1.841 |
| deep-thin (16 x 384) | 27.5M | 3,906 | 2.898 / 2.477 / 2.265 / 2.093 / 1.922 |

The hybrid led at every checkpoint and is the fastest here. One seed, 20 minutes: the margin over
classic (1.5%) is small; the speed and llama.cpp's phone-tuned `lfm2` path decided it. Looping tied
classic with half the params at equal compute (research: at <=135M it loses at iso-FLOPs,
[MoR](https://arxiv.org/html/2507.10524v1), [CHASE](https://arxiv.org/abs/2607.10110)).
Deep-thin's small matrices run slowly on this CPU.

## Size
8 h at ~6,700 tok/s is ~190M tokens. Compute-optimal is ~8 tokens/param
([nanochat](https://github.com/karpathy/nanochat/discussions/420)), so ~19M: `hybrid19`
(10 layers x 384, attention at 2,4,6,8 like [LFM2.5-230M](https://huggingface.co/LiquidAI/LFM2.5-230M/raw/main/config.json)).
A 20-min size race would favour the smaller model, so it wasn't run.

## Data (licenses: the app is sold)
- [SimpleStories](https://huggingface.co/datasets/SimpleStories/SimpleStories), **MIT**: beats TinyStories at 30-35M ([paper](https://arxiv.org/html/2504.09184v2)).
- [SODA](https://huggingface.co/datasets/allenai/soda), **CC-BY-4.0: credit it in the app.** Two-speaker dialogues, rendered as `<|user|>`/`<|orb|>` turns.
- [TinyDialogues](https://huggingface.co/datasets/styfeng/TinyDialogues), **MIT**.
- TinyStories (race only) is CDLA-Sharing-1.0: share-alike covers the data, not trained models.
- Avoid: DailyDialog, EmpatheticDialogues (non-commercial), nanochat's ClimbMix (NC).
- DeepSeek's [terms](https://cdn.deepseek.com/policies/en-US/deepseek-terms-of-use.html) allow training on outputs, including
  distillation; the platform terms ask apps to tell users output is AI-generated. Not legal advice.

## Tricks
- Muon (`torch.optim.Muon`, 2D matrices only; AdamW for embeddings, norms, conv kernels): ~1.35-1.4x at ~100M ([Jordan](https://kellerjordan.github.io/posts/muon/), [Wen+](https://arxiv.org/abs/2509.02046)).
- bf16 autocast on AMX: 2.4x here (measured). `torch.compile`: no gain (measured).
- Skipped: multi-token prediction (hurts small models, [Gloeckle](https://arxiv.org/html/2404.19737)), diffusion LMs
  (~16x the training to match, [arXiv](https://arxiv.org/abs/2410.18514)), value embeddings / ReLU^2 + QK-norm (no llama.cpp arch has them).

## Export notes (llama.cpp `lfm2`)
[converter](https://raw.githubusercontent.com/ggml-org/llama.cpp/master/conversion/lfm2.py): architecture `Lfm2ForCausalLM`;
config needs `layer_types` ("conv"/"full_attention"), `conv_L_cache`, `norm_eps`, and the `block_auto_adjust_ff_dim`,
`block_ffn_dim_multiplier`, `block_multiple_of` keys; conv weights [d,1,L] -> [d,L]. A conv layer is one whose
`n_head_kv` is 0. The final norm is `embedding_norm`; RoPE theta 1e6 upstream (ours: 1e4, set it in the config).
Our tokenizer is SentencePiece: the GGUF vocab can be written as `llama` (SPM) regardless of arch; check it.
