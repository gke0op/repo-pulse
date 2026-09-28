# Small chat LLMs (0.5B-4.5B) to replace Gemma 3 4B it as an offline Android persona brain (Oct 2025 - Sep 2026)

Research date: 2026-09-28. About 20 tool calls. Primary sources where I could get them (HF model cards, vendor blogs, llama.cpp GitHub). Aggregator and community sources are marked. Anything I could not source is under Gaps.

## Q1. Which new small models exist (verified existence and dates)?

### Takeaway
Five families from the window are real and worth a look: **Gemma 4 E2B/E4B** (Google, Apr 2026), **Qwen3.5 0.8B/2B/4B** (Mar 2026), **Ministral 3 3B** (Mistral, 2512 = Dec 2025), **LFM2.5-1.2B** (Liquid, Jan 2026), and **MiniCPM5-1B/2B** (OpenBMB, 2026). IBM **Granite 4.0 Nano/Micro** (Oct 2025) are also in the window but aimed at enterprise and tool use. Qwen3.6 and Qwen3.8 have **no** small models. I found no Llama 4 small model and no Phi-5-mini.

### Cited Findings
- **Gemma 4** was released 2026-04-02 in four sizes: E2B, E4B, 26B MoE and 31B dense. — [Google blog](https://blog.google/innovation-and-ai/technology/developers-tools/gemma-4/). The model card cites a tech report arXiv 2607.02770 (July 2026), which the fetch summary wrongly read as a "July 2026 release". The weights came out in April. — [HF google/gemma-4-E2B-it](https://huggingface.co/google/gemma-4-E2B-it)
- **Qwen3.5 small series** (0.8B, 2B, 4B, 9B) was released 2026-03-02 under Apache 2.0. The models are natively multimodal with hybrid thinking and non-thinking modes. — [Qwen on X](https://x.com/Alibaba_Qwen/status/2028460046510965160); [MarkTechPost](https://www.marktechpost.com/2026/03/02/alibaba-just-released-qwen-3-5-small-models-a-family-of-0-8b-to-9b-parameters-built-for-on-device-applications/)
- **Qwen3.6** (Apr 2026: 27B, 35B-A3B) and **Qwen3.8** (Aug 2026: 27B, 2.4T-A95B) have no 4B, 8B or 14B models. For small Qwen models you still use Qwen3.5. — [codersera (aggregator)](https://codersera.com/blog/qwen-3-8-model-lineup-2026/)
- **Ministral 3 3B Instruct 2512** is a 3.4B LM plus a 0.4B vision encoder under Apache 2.0, with an official Mistral GGUF repo. There is also a Reasoning variant. — [HF mistralai/Ministral-3-3B-Instruct-2512-GGUF](https://huggingface.co/mistralai/Ministral-3-3B-Instruct-2512-GGUF); [Reasoning GGUF](https://huggingface.co/mistralai/Ministral-3-3B-Reasoning-2512-GGUF). The card cites paper arXiv 2601.08584 (Jan 2026). The fetch tool reported the date as "January 13, 2025", which is inconsistent with the "2512" tag. The "2512" tag points to a Dec 2025 release (inference).
- **LFM2.5** was announced 2026-01-05: LFM2.5-1.2B-Base, -Instruct, -JP, LFM2.5-VL-1.6B and LFM2.5-Audio-1.5B. — [Liquid AI blog](https://www.liquid.ai/blog/introducing-lfm2-5-the-next-generation-of-on-device-ai). A smaller LFM2.5-230M followed in June 2026. — [MarkTechPost](https://www.marktechpost.com/2026/06/27/liquid-ai-ships-lfm2-5-230m-with-llama-cpp-mlx-vllm-sglang-and-onnx-support-for-on-device-inference/). The older LFM2-2.6B (2025) is the largest text LFM. The LFM2.5 card lists no 2.5-generation text model above 1.2B. — [HF LFM2-2.6B](https://huggingface.co/LiquidAI/LFM2-2.6B); [HF LFM2.5-1.2B-Instruct](https://huggingface.co/LiquidAI/LFM2.5-1.2B-Instruct)
- **MiniCPM5-1B and MiniCPM5-2B** are dense on-device Transformers from OpenBMB, with official GGUFs. — [HF MiniCPM5-2B](https://huggingface.co/openbmb/MiniCPM5-2B); [MiniCPM5-2B-GGUF](https://huggingface.co/openbmb/MiniCPM5-2B-GGUF); [GitHub OpenBMB/MiniCPM](https://github.com/openbmb/minicpm). MiniCPM-V 4.6 (2026-05-17) is a VLM built on the Qwen3.5-0.8B LLM. — [HF MiniCPM-V-4.6](https://huggingface.co/openbmb/MiniCPM-V-4.6)
- **IBM Granite 4.0**: Micro (3B dense), H-Micro (3B hybrid), and Nano (Oct 2025: H-1B at about 1.5B, H-350M, plus non-hybrid transformer versions "for llama.cpp compatibility"). All are Apache 2.0. — [HF blog Granite 4.0 Nano](https://huggingface.co/blog/ibm-granite/granite-4-nano); [MarkTechPost 2025-10-29](https://www.marktechpost.com/2025/10/29/ibm-ai-team-releases-granite-4-0-nano-series-compact-and-open-source-small-models-built-for-ai-at-the-edge/); [IBM announcement](https://www.ibm.com/new/announcements/ibm-granite-4-0-hyper-efficient-high-performance-hybrid-models)
- **SmolLM3** (3B, 2025) is the latest SmolLM I found. No 2026 SmolLM surfaced. — [Wikipedia: Hugging Face](https://en.wikipedia.org/wiki/Hugging_Face)

### Inferences
- The only newly released in-window families that realistically compete with Gemma 3 4B on chat quality at 2B-4.5B are Gemma 4 E2B/E4B, Qwen3.5-4B/2B, Ministral 3 3B and MiniCPM5-2B. LFM2.5-1.2B is a speed and thermal option, not a quality upgrade.
- Gemma 4 is the natural next step from the current Gemma 3 setup: same vendor style, and it fixes Gemma 3's lack of a system role (see Q2).

### Gaps
- No Llama 4 small, Phi-4-mini successor, Hunyuan/ERNIE small, OLMo small or SmolLM4 release in the window turned up in searches. I did not run a dedicated search for each, so "none exist" is unconfirmed.
- MiniCPM5's exact release date is unconfirmed. The HF card summary gave "June 9, 2025 (arXiv 2506.07900)", but that ID is the MiniCPM4 tech report, so the date is not reliable. The "MiniCPM5" branding and the Qwen3.5-based MiniCPM-V 4.6 point to 2026.
- Gemma 3n (June 2025, out of window) was not researched here.

## Q2. Specs per model: params, architecture, context, license, llama.cpp/GGUF, KV/context shift

### Takeaway
Both headline candidates have **non-standard KV memory that breaks llama.cpp context shift**. Gemma 4 uses SWA plus global layers. Qwen3.5 is a Gated-DeltaNet hybrid. Ministral 3 3B and MiniCPM5-2B are plain dense attention (MiniCPM5 is literally `LlamaForCausalLM`), so shift and cache reuse should work normally. Plan context management as "truncate and re-prefill" if Gemma 4 or Qwen3.5 is chosen.

### Cited Findings
| Model | Params | Architecture | Context | License | GGUF | Source |
|---|---|---|---|---|---|---|
| Gemma 4 E2B-it | 2.3B effective / 5.1B total incl. PLE embeddings | 35 layers, Per-Layer Embeddings, 512-token sliding window interleaved with global attention; text+image+audio in; `<\|think\|>` configurable thinking; **native system role** | 128K | Apache 2.0 | yes ([unsloth](https://huggingface.co/unsloth/gemma-4-E2B-it-GGUF), Ollama `gemma4:e2b`) | [HF card](https://huggingface.co/google/gemma-4-E2B-it) |
| Gemma 4 E4B-it | 4.5B effective / 8B total | 42 layers, same PLE + 512 SWA hybrid | 128K | Apache 2.0 | yes | [HF card](https://huggingface.co/google/gemma-4-E4B) |
| Qwen3.5-4B | ~4B, hidden 2560 | 32 layers = 8 x (3 x Gated DeltaNet + 1 x Gated Attention); GQA 16Q/4KV; vision built in; **thinking ON by default** (`enable_thinking: False` to disable) | 262K (YaRN to ~1M) | Apache 2.0 | yes ([unsloth collection](https://huggingface.co/collections/unsloth/qwen35)) | [HF Qwen3.5-4B](https://huggingface.co/Qwen/Qwen3.5-4B) |
| Qwen3.5-2B / 0.8B | 2B / 0.8B | same hybrid family | 262K | Apache 2.0 | yes | [Artificial Analysis](https://artificialanalysis.ai/articles/qwen3-5-small-models) |
| Ministral 3 3B Instruct 2512 | 3.4B LM + 0.4B vision | dense; "strong adherence and support for system prompts" | 256K | Apache 2.0 | **official Mistral GGUF** incl. Q4_K_M | [HF GGUF](https://huggingface.co/mistralai/Ministral-3-3B-Instruct-2512-GGUF) |
| MiniCPM5-2B | 2.52B total / 1.98B non-embedding | standard `LlamaForCausalLM`, 42 layers, 16Q/2KV GQA; optional thinking | 131K (card recommends `-c 8192`) | Apache 2.0 | official GGUF | [HF card](https://huggingface.co/openbmb/MiniCPM5-2B) |
| LFM2.5-1.2B-Instruct | 1.17B | hybrid: 10 double-gated LIV conv blocks + 6 GQA blocks, 16 layers; ChatML-like template | 32K | LFM Open License 1.0 (not Apache) | official GGUF (Q4_0, QAD and PTQ) | [HF card](https://huggingface.co/LiquidAI/LFM2.5-1.2B-Instruct); [GGUF](https://huggingface.co/LiquidAI/LFM2.5-1.2B-Instruct-GGUF); [Liquid llama.cpp docs](https://docs.liquid.ai/deployment/on-device/llama-cpp) |
| Granite 4.0 H-1B / Micro 3B | ~1.5B / 3B | hybrid Mamba-2 (H) or plain transformer variants | — | Apache 2.0 | yes ([IBM/gguf](https://github.com/IBM/gguf)) | [HF blog](https://huggingface.co/blog/ibm-granite/granite-4-nano) |

- **Context shift on Gemma 4 is broken or disabled in llama.cpp.** Issue #21379 (2026-04-03, build b8648) logs "forcing full prompt re-processing due to lack of cache data (likely due to SWA or hybrid/recurrent memory)". It was still open with no maintainer fix at fetch time. — [llama.cpp #21379](https://github.com/ggml-org/llama.cpp/issues/21379); [discussion #21374](https://github.com/ggml-org/llama.cpp/discussions/21374)
- Mechanism: with SWA, the older KV entries in the SWA layers are already evicted, so `llama_memory_seq_add` cannot produce a consistent cache. Only the global layers survive a shift. `--swa-full` keeps full KV so shifting can work, at the cost of more RAM. — [search summary of llama.cpp discussions #14170 / #21374](https://github.com/ggml-org/llama.cpp/discussions/14170). This is the same class of problem the project already handles for Gemma 3.
- Cache reuse (`--cache-reuse`) was reported unsupported for Gemma 4 even with `-fa` and `--swa-full`. — [llama.cpp #21468](https://github.com/ggml-org/llama.cpp/issues/21468)
- A community complaint (2026-06-23) says KV shifting is disabled for **Qwen 3.5/3.6 and Gemma 4**, citing M-RoPE, interleaved or hybrid layers and reasoning tokens. When a chat hits n_ctx, the engine halts or fully recomputes. — [llama.cpp discussion #24944](https://github.com/ggml-org/llama.cpp/discussions/24944). The suggested workaround is to truncate history at the template level, clear the cache and re-prefill. — [discussion #27213](https://github.com/ggml-org/llama.cpp/discussions/27213)
- Hybrid/recurrent (DeltaNet/Mamba) models had a context-checkpoint restore bug in the server. — [llama.cpp #22384](https://github.com/ggml-org/llama.cpp/issues/22384)

### Inferences
- **Gemma 4 has a real system role**, unlike Gemma 3, which folds the system prompt into the first user turn. That should help persona adherence and the "[happy]" emotion-tag prefill. Verify the GGUF's embedded Jinja template before relying on it.
- Gemma 4 E2B's "5.1B total" is mostly PLE embedding tables. LiteRT can keep those out of RAM, but in llama.cpp the GGUF on disk and the mmap'd RAM will probably be much larger than a "2B" suggests (unverified, check the actual Q4_K_M file size). E4B at 8B total may be heavy for the 8 GB S20+.
- Qwen3.5's DeltaNet layers keep a fixed-size recurrent state, so per-token cost barely grows with history. That is good for thermals in long sessions, but you cannot shift or truncate the recurrent state. Any history edit means re-prefilling from the edit point.
- Ministral 3 3B and MiniCPM5-2B are the most "drop-in" for the existing llama.cpp context-shift code path.

### Gaps
- Could not confirm whether llama.cpp has merged a Gemma 4 context-shift fix since June 2026.
- Could not verify Q4_K_M file sizes for Gemma 4 E2B/E4B GGUFs, or whether llama.cpp loads the audio and vision towers only with mmproj (it normally does, so text-only use should skip them).

## Q3. Measured on-device CPU speeds (Snapdragon / ARM)

### Takeaway
Vendor numbers exist for **Gemma 4 on LiteRT-LM (not llama.cpp)** and for **LFM2.5 on llama.cpp-class CPU**. I found no credible llama.cpp pp/tg numbers on Snapdragon 8 Gen 3 for any in-window model. Expect Gemma 4 E2B to decode about 2-4x faster than Gemma 3 4B, and E4B to be about the same speed or slower.

### Cited Findings
- **Gemma 4 E2B, LiteRT-LM (Google):** S26 Ultra CPU 557 tok/s prefill, 46.9 tok/s decode, 1.8 s TTFT, 1733 MB. S26 Ultra GPU 3808 / 52.1 tok/s. Generic Arm Linux CPU 260 / 35.0 tok/s. — [HF litert-community gemma-4-E2B-it-litert-lm](https://huggingface.co/litert-community/gemma-4-E2B-it-litert-lm)
- **Gemma 4 E4B, LiteRT-LM:** S26 Ultra CPU 195 tok/s prefill, 17.7 tok/s decode, 5.3 s TTFT, 3283 MB. GPU 1293 / 22.1 tok/s. The model file is 3.66 GB. — [HF litert-community gemma-4-E4B-it-litert-lm](https://huggingface.co/litert-community/gemma-4-E4B-it-litert-lm)
- **LFM2.5-1.2B-Instruct:** Galaxy S25 Ultra (Snapdragon 8 Elite) CPU 335 tok/s prefill, 70 tok/s decode, 719 MB. ROG Phone 9 Pro NPU 4391 / 82 tok/s. Ryzen AI 9 HX 370 CPU 2975 / 116 tok/s. — [Liquid AI blog](https://www.liquid.ai/blog/introducing-lfm2-5-the-next-generation-of-on-device-ai)
- Gemma 4 E2B Q4 in llama.cpp: "15-25 tok/s on smartphones", "2-5 tok/s on Raspberry Pi 5". **Community/aggregator, unverified.** — [Lushbinary](https://lushbinary.com/blog/gemma-4-edge-deployment-mobile-iot-on-device-ai-guide/)
- The llama.cpp Android performance discussion covers Hexagon/QNN backend work and has no usable pp512/tg128 numbers for these models. — [llama.cpp discussion #14356](https://github.com/ggml-org/llama.cpp/discussions/14356)
- Qwen3.5 small models are extremely verbose in thinking mode (230M+ output tokens to run AA's Intelligence Index). Q4 sizes: 4B about 3 GB, 2B/0.8B under 2 GB. — [Artificial Analysis](https://artificialanalysis.ai/articles/qwen3-5-small-models)

### Inferences
- The S26 Ultra is two generations newer than the S24 Ultra (8 Gen 3), and LiteRT is not llama.cpp. Scale roughly: E2B on S24U llama.cpp CPU would plausibly land at about 20-30 tok/s decode, and E4B at about 8-12 tok/s, similar to today's Gemma 3 4B (inference, unmeasured). E4B probably does **not** fix thermals. E2B probably does.
- LFM2.5-1.2B at about 70 tok/s decode on 8 Elite CPU is about 7x the current speed. That is a large thermal headroom win if its persona quality holds up. The card's recommended temp 0.1 and its "not recommended for knowledge-intensive tasks" note hint that it is tuned for extraction and agentic work, not warm chat.
- **Always run Qwen3.5 with thinking disabled** for voice. Thinking tokens would wreck latency and power.

### Gaps
- No llama.cpp `llama-bench` numbers on 8 Gen 3 or an S20+ (Exynos 990 / SD865) for Gemma 4, Qwen3.5, Ministral 3 or MiniCPM5. These must be measured in-house.
- No tokens-per-watt data from any credible source.

## Q4. Evidence on roleplay/persona quality, emotional expressiveness, instruction following

### Takeaway
Hard persona/RP evidence for sub-5B in-window models is **essentially absent** from primary sources. The EQ-Bench leaderboard did not render for scraping. IFEval is high across the board (Qwen3.5-4B 89.8, MiniCPM5-2B 86.7, LFM2.5-1.2B 86.2), which predicts that memory-note distillation will work, but it says little about warmth or staying in character. You will need your own harness.

### Cited Findings
- IFEval: **Qwen3.5-4B 89.8** (MMLU-Pro 79.1). — [HF Qwen3.5-4B](https://huggingface.co/Qwen/Qwen3.5-4B). **MiniCPM5-2B 86.7** (MMLU-Pro 70.8). — [HF MiniCPM5-2B](https://huggingface.co/openbmb/MiniCPM5-2B). **LFM2.5-1.2B 86.23**, IFBench 47.33, MMLU-Pro 44.35. — [Liquid blog](https://www.liquid.ai/blog/introducing-lfm2-5-the-next-generation-of-on-device-ai)
- Gemma 4 E2B / E4B: MMLU-Pro 60.0 / 69.4, GPQA-D 43.4 / 58.6. The fetched card excerpt showed no IFEval number. — [HF gemma-4-E2B-it](https://huggingface.co/google/gemma-4-E2B-it)
- Qwen3.5-4B has an **80% hallucination rate** on the AA-Omniscience-style metric (accuracy 12.8%). That is a warning sign for "low hallucination of personal facts". — [Artificial Analysis](https://artificialanalysis.ai/articles/qwen3-5-small-models)
- Community: Gemma 4 (31B) has become the go-to base for local RP and creative-writing finetunes, with 115 Gemma 4 31B finetunes vs 63 Qwen3.6/3.8-27B. This is about the big model, not E2B/E4B. — [XDA / aggregator via search](https://www.xda-developers.com/ran-gemma-4-and-qwen-35-for-same-local-tasks-one-pulled-ahead/) (community)
- Community: "Gemma 3 is exceptionally good at roleplay for its size(s)" but restrictive at the pretraining level. — [itch.io post](https://itch.io/post/15666526) (community, anecdotal)
- Ministral 3 cards emphasise "strong adherence and support for system prompts" and recommend temp below 0.1 for production, with higher temp for creative tasks. — [HF Ministral-3-3B GGUF](https://huggingface.co/mistralai/Ministral-3-3B-Instruct-2512-GGUF)
- Qwen3.5's recommended non-thinking sampling is temp 0.7, top_p 0.8, top_k 20, **presence_penalty 1.5**. — [HF Qwen3.5-4B](https://huggingface.co/Qwen/Qwen3.5-4B)

### Inferences
- The project already saw Qwen3 4B 2507 spam emoji, and Qwen3.5 comes from the same lineage, is RL-heavy and has a high hallucination rate. Treat Qwen3.5-4B as the "smartest but riskiest persona" candidate.
- Gemma lineage has the best community reputation for RP, and Gemma 4 adds a system role. **Gemma 4 E2B is the top a-priori pick** (quality at or near Gemma 3 4B with about 2-4x the speed), and E4B is the quality ceiling.
- Ministral 3 3B is the best "clean dense arch plus system-prompt adherence" alternative. Mistral models historically lean less assistant-like (weak prior, unverified).

### Gaps
- No EQ-Bench 3 / Creative Writing v3 / Longform scores retrieved for any of these small models (the page loads its data with JS). Check eqbench.com manually.
- No RP-specific benchmark results (PingPong, CharacterEval, RPBench) found for in-window small models.
- No data on emoji or markdown tendencies, or on how well each follows a "[happy]" prefill.

## Q5. Best candidates for this app and the first concrete test

### Takeaway
A/B test **(1) Gemma 4 E2B-it**, **(2) Ministral 3 3B Instruct 2512**, and **(3) either Gemma 4 E4B-it (quality ceiling) or Qwen3.5-4B with thinking off (IFEval and smarts)**. Keep **LFM2.5-1.2B** as a thermal fallback and memory-distillation worker for the S20+. MiniCPM5-2B is a reasonable dark horse (plain Llama architecture, IFEval 86.7) if the others fail on persona.

### Cited Findings
- (see the specs, speed and IFEval citations in Q2-Q4)

### Inferences
- **Gemma 4 E2B**. Pros: vendor-measured decode about 47 tok/s on a flagship CPU (LiteRT), Gemma-family persona reputation, native system role, Apache 2.0. Cons: SWA context shift is broken in llama.cpp (same class of problem as Gemma 3, so existing mitigations may carry over), PLE RAM footprint in llama.cpp is unclear, and it may be too weak for memory-note distillation.
- **Ministral 3 3B**. Pros: dense architecture with no context-shift issues, official Q4_K_M GGUF, strong system-prompt adherence, Apache 2.0. Cons: 3.4B dense means speed is probably similar to Llama 3.2 3B (the project's close second), and there is no persona evidence.
- **Gemma 4 E4B**. Pros: likely the best persona quality. Cons: LiteRT CPU decode of only 17.7 tok/s on an S26U and a 3.3 GB footprint, so it probably will not fix thermals and is risky on 8 GB.
- **Qwen3.5-4B (no-think)**. Pros: best IFEval (89.8), cheap long history thanks to DeltaNet. Cons: emoji and assistant-y risk from Qwen lineage, 80% hallucination rate, no context shift.
- **First concrete test:** on the Mac harness, run `persona_eval` + `drift_eval` + `recall_eval` on the same replayed conversations for Gemma 3 4B (baseline), Gemma 4 E2B, Ministral 3 3B and Gemma 4 E4B, all at Q4_K_M, with the real system prompt and "[happy]" prefill.
  - Check the GGUF's chat template and switch to the native system role for Gemma 4, keeping Gemma 3 as is.
  - Force thinking off (`enable_thinking=false` or omit `<|think|>`).
  - Log emoji/markdown rate, mean reply length in words, and emotion-tag compliance.
  - In parallel, run `llama-bench -p 512 -n 128 -t 4` on the S24U for each GGUF, plus a 10-minute sustained-generation loop to capture thermal decay.
  - Also test the context-full path with a long replay to confirm how the app handles "full re-processing" on Gemma 4.

### Gaps
- No direct persona/drift/recall data exists publicly. The harness results will decide.
- The S20+ (8 GB) feasibility of E4B and Qwen3.5-4B is unverified.
