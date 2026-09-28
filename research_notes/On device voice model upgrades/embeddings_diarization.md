# Embeddings for long-term memory, and diarization / echo / barge-in helpers (offline Android, S24 Ultra CPU)

Scope: releases about Oct 2025 - Sep 2026 (today 2026-09-28), older models as baseline. Target: Snapdragon 8 Gen 3, CPU only, llama.cpp (GGUF) or ONNX Runtime / sherpa-onnx, next to Gemma 3 4B with thermal throttling as the main limit. Research ran on a budget of about 15 tool calls. Anything taken from background knowledge instead of a page fetched in this session is marked **[UNVERIFIED]**.

## A1. Which small text embedding models are the best candidates for note retrieval and near-duplicate detection?

### Takeaway
New in the window: Granite Embedding Multilingual R2 (IBM, May 2026: 97M and 311M), Microsoft Harrier-OSS-v1 (Mar/Apr 2026: 270M and 0.6B, MIT) and Bekko Embedding (Jul 2026: 8M and 25M active params, CC BY 4.0). EmbeddingGemma-300M (Sep 2025) is still the safest phone pick. It has first-class llama.cpp/GGUF support, Matryoshka down to 128 dims and a footprint under 200 MB. For a few hundred short notes, a sub-100M model such as granite-embedding-97m-multilingual-r2 or granite-small-english-r2 (47M) is probably enough and costs much less heat.

### Cited Findings
**EmbeddingGemma-300M (Google, Sep 2025, baseline)**
- 308M params, built on Gemma 3 with bidirectional attention (encoder), mean pooling plus two dense layers. Context 2,048 tokens. 768-dim output, truncatable by MRL to 512/256/128. 100+ languages — [HF blog](https://huggingface.co/blog/embeddinggemma)
- MTEB at full precision: 61.15 Multilingual v2, 69.67 English v2, 68.76 Code v1 — [BentoML guide](https://www.bentoml.com/blog/a-guide-to-open-source-embedding-models) (aggregator)
- Highest-ranked text-only model under 500M params on MTEB multilingual at publication — [Google Developers Blog](https://developers.googleblog.com/en/introducing-embeddinggemma/); [HF blog](https://huggingface.co/blog/embeddinggemma)
- Runs in less than 200 MB RAM when quantized. Under 15 ms per 256-token input on EdgeTPU (another aggregator says under 22 ms) — [Google Developers Blog](https://developers.googleblog.com/en/introducing-embeddinggemma/); [BentoML](https://www.bentoml.com/blog/a-guide-to-open-source-embedding-models)
- Runtimes: llama.cpp, ONNX Runtime, LiteRT, transformers.js, MLX, Ollama — [HF blog](https://huggingface.co/blog/embeddinggemma); [Google Dev Blog](https://developers.googleblog.com/en/introducing-embeddinggemma/)
- Required prompts: query `"task: search result | query: "`, document `"title: none | text: "` — [HF blog](https://huggingface.co/blog/embeddinggemma)
- Medical-retrieval example (NDCG@10): Qwen3-Embedding-0.6B 0.8493, EmbeddingGemma 0.8340 — [HF blog](https://huggingface.co/blog/embeddinggemma)
- A third party measured llama.cpp against ONNX Runtime on Apple Metal (not Android). EmbeddingGemma Q8_0 took 11.4 ms per short claim and 114 ms per 16 claims in llama.cpp, against 962 ms in ORT — [agmem PR #180](https://github.com/AlfoldiMate/agmem/pull/180). This is Metal GPU, so it does not carry over directly to phone CPU.
- License: the HF blog summary says "Apache 2.0 (under Gemma terms)". **Conflict / [UNVERIFIED]:** EmbeddingGemma is generally released under the Gemma Terms of Use, not plain Apache 2.0. Check the model card before shipping — [HF blog](https://huggingface.co/blog/embeddinggemma)

**Granite Embedding Multilingual R2 (IBM, 2026-05-14), new in window**
- Two sizes. 97M: 384 dims, no Matryoshka. 311M: 768 dims, Matryoshka to 512/384/256/128. Both have a 32,768-token context and cover 200+ languages (52 emphasized) — [IBM HF blog](https://huggingface.co/blog/ibm-granite/granite-embedding-multilingual-r2); [arXiv 2605.13521](https://arxiv.org/pdf/2605.13521)
- MTEB Multilingual Retrieval: 97M = 60.3 (best open model under 100M), 311M = 65.2 (#2 open model under 500M). The 97M beats multilingual-e5-small (50.9) by 9.4 points — [IBM HF blog](https://huggingface.co/blog/ibm-granite/granite-embedding-multilingual-r2)
- Ships with ONNX and OpenVINO weights. Apache 2.0. Trained without MS-MARCO, which suits commercial use. Speeds quoted are H100 GPU only (97M about 2,500 docs/s) — [IBM HF blog](https://huggingface.co/blog/ibm-granite/granite-embedding-multilingual-r2)

**granite-embedding-small-english-r2 (IBM, Aug 2025, baseline for English only)**
- 47M params, 384 dims, 8,192 context. Averages 55.6 on MTEB retrieval, #2 under 100M params. Encodes about 200 docs/s (hardware not stated in snippet). Official ONNX export at onnx-community — [Granite R2 blog](https://huggingface.co/blog/hansolosan/granite-embedding-r2); [onnx-community ONNX](https://huggingface.co/onnx-community/granite-embedding-small-english-r2-ONNX); [arXiv 2508.21085](https://arxiv.org/pdf/2508.21085)

**Microsoft Harrier-OSS-v1 (Bing team, Mar-Apr 2026), new in window**
- Three sizes: 27B, 0.6B, 270M. MIT license. 94-100+ languages. 32K context. The 0.6B and 270M were distilled from the larger models — [Bing blog](https://blogs.bing.com/search/April-2026/Microsoft-Open-Sources-Industry-Leading-Embedding-Model); [The Decoder](https://the-decoder.com/microsofts-bing-team-open-sources-harrier-embedding-model/); [MarkTechPost](https://www.marktechpost.com/2026/03/30/microsoft-ai-releases-harrier-oss-v1-a-new-family-of-multilingual-embedding-models-hitting-sota-on-multilingual-mteb-v2/)
- Multilingual MTEB v2: 0.6B = 69.0, 270M = 66.5, 27B = 74.3 — [HF card 270m](https://huggingface.co/microsoft/harrier-oss-v1-270m); [The Decoder](https://the-decoder.com/microsoft-bing-team-open-sources-harrier-embedding-model/)
- 270M is decoder-only with last-token pooling and 640 dims. The card documents no Matryoshka. Queries need a one-sentence task instruction; documents do not. The card lists safetensors only, with no official GGUF or ONNX — [HF card 270m](https://huggingface.co/microsoft/harrier-oss-v1-270m)
- On paper, Harrier-270M's MTEB v2 score (66.5) is well above EmbeddingGemma's (61.15). **Caveat:** these are overall mean scores, not the retrieval subset, and both come from vendor or aggregator reporting.

**Bekko Embedding (Yuichi Tateno, arXiv 2026-07-28), new in window, ultra-compact**
- a8m (just under 8M active params) and a25m (about 25M active). MTEB Multilingual v2 Retrieval nDCG@10: 56.2 and 57.5. The authors claim a8m beats the multilingual-e5 family and BGE-M3, and a25m matches gte-multilingual-base — [arXiv 2607.25180](https://arxiv.org/abs/2607.25180)
- 1.6x faster than multilingual-e5-small on x86 CPU and fastest on Raspberry Pi 5. The int8 ONNX/OpenVINO build of a8m is 124 MiB. Runs in Transformers.js. License CC BY 4.0. Weights are on HF under "hotchpotch" — [arXiv 2607.25180](https://arxiv.org/abs/2607.25180). "Active params" suggests a large embedding table plus a small encoder. The file is 124 MiB even at 8M active params, so memory is not tiny.

**Qwen3-Embedding-0.6B (Jun 2025, baseline)**
- Described as strong for its size, trailing only Gemini-Embedding in the Qwen report — [arXiv 2506.05176](https://arxiv.org/pdf/2506.05176)
- **[UNVERIFIED, from background knowledge]:** 596M params, 1,024 dims with MRL, 32K context, MTEB multilingual about 64.3, Apache 2.0, official GGUF repo (Qwen/Qwen3-Embedding-0.6B-GGUF). Decoder with last-token pooling, which makes it about 2x EmbeddingGemma's compute per token.

**Static embeddings (model2vec / potion)**
- potion-base-32M: MTEB average 51.66, about 92% of all-MiniLM-L6-v2. potion-retrieval-32M: retrieval score 35.06, about 82% of MiniLM on retrieval. Both are "orders of magnitude faster" because they need no transformer forward pass — [model2vec README](https://github.com/MinishLab/model2vec); [potion-retrieval-32M card](https://huggingface.co/minishlab/potion-retrieval-32M); [results](https://github.com/MinishLab/model2vec/blob/main/results/README.md)
- No newer potion retrieval model from Oct 2025 - Sep 2026 turned up in this search.

**Not covered with fetched sources (gaps below):** nomic-embed v2, snowflake arctic-embed small, jina v3/v4 small, bge-m3 successors.

### Inferences
- **Recommended first pick: EmbeddingGemma-300M Q8_0 GGUF at 256-dim MRL.** The app already uses llama.cpp and Gemma 3, so one runtime and one tokenizer family are reused (sharing the tokenizer is **[UNVERIFIED]**). It has the best-documented phone story. Embedding one user turn (about 20-40 tokens) per turn is a small workload next to Gemma 3 4B decoding. Expect tens of ms on 2 big cores — **not measured on the S24; test it**.
- **Low-heat alternative: granite-embedding-97m-multilingual-r2 (ONNX, 384-dim) or Bekko a25m.** Both are 3-12x fewer active params, with retrieval scores in the same range. Granite is Apache 2.0, the cleanest license. Bekko is CC BY 4.0 (attribution needed).
- **Harrier-270M has higher reported scores**, but has no official GGUF/ONNX (it may run through llama.cpp's Gemma 3 path if it is Gemma 3 270M-based — **[UNVERIFIED]**), needs query instructions, and has no MRL. Treat it as a second-round candidate.
- A 0.6B model (Qwen3 or Harrier-0.6B) brings little gain for hundreds of short notes and roughly doubles the heat and RAM of EmbeddingGemma. Skip it.
- Storage is trivial: 500 notes x 256 dims x float32 = 512 KB. Brute-force cosine search takes microseconds, so no vector database is needed.
- Near-duplicate detection when merging notes: cosine similarity of 0.90 or more on the same embedding flags candidates, followed by a tag check ("you:"/"wish:"/"us:"). The threshold must be tuned on real notes; it is not sourced.

### Gaps
- No published Android/Snapdragon CPU latency for any of these models was found. The only CPU numbers are x86 or Raspberry Pi (Bekko) and Apple Metal (EmbeddingGemma llama.cpp).
- Did not fetch official MTEB retrieval-only subscores for EmbeddingGemma, Harrier or Qwen3-0.6B, so the headline figures mix overall averages and retrieval subsets. Not directly comparable.
- nomic-embed v2, arctic-embed small (v2), jina v3/v4 small and 2026 bge successors were not researched in the call budget.
- Whether llama.cpp supports Harrier or Bekko architectures was not checked.

## A2. Is BM25 or a static model (model2vec) good enough for a few hundred short notes?

### Takeaway
Probably only as a first stage or fallback. Static retrieval models reach about 82% of MiniLM's retrieval quality, and BM25 misses paraphrases ("my dog" vs "your puppy"). Those are exactly the matches a companion's memory needs. A hybrid with BM25 or potion as a free first pass and a small transformer embedding for scoring is the pragmatic choice.

### Cited Findings
- potion-retrieval-32M reaches 81.69% of all-MiniLM-L6-v2's retrieval score (35.06), while running orders of magnitude faster — [model2vec README](https://github.com/MinishLab/model2vec)
- Bekko a8m reaches 56.2 nDCG@10 on multilingual retrieval with about 8M active params, which narrows the cost gap between static and transformer models — [arXiv 2607.25180](https://arxiv.org/abs/2607.25180)

### Inferences
- With under 1,000 notes, cost barely matters: even a 300M model embeds all notes once (at note-write time) and one query per turn. The heat comes from Gemma 3 4B, not from retrieval. Quality should drive the choice, so a transformer embedding is preferred.
- BM25 is still worth keeping as a zero-cost boost for exact names and entities (pet names, places). A simple hybrid: score = 0.7*cosine + 0.3*normalized BM25 (weights not sourced; tune them).
- Keep "pinned" notes, such as the character's core facts, always in the prompt, and retrieve the top 3-5 of the rest per turn.

### Gaps
- No benchmark was found that measures BM25 against dense retrieval on small corpora of short personal-memory notes. This needs an in-house eval of about 50 hand-written query-to-note pairs.

## B1. Nemotron 3 Diarization: details, runtimes, Android feasibility, comparison with sherpa-onnx options

### Takeaway
Nemotron 3 Diarization (2026-09-23) is a 100M streaming Sortformer that cuts DER by about 40% relative to streaming Sortformer v2.1. NVIDIA officially targets Linux on NVIDIA GPUs only. Its C++ runtime, NeMo-Speech.cpp, is ggml-based with a CPU preset, and a third-party fork has already run it on an Android arm64 phone at RTF 0.60, combined with ASR, on 2 cores. It is feasible on the S24 but not free, and it solves a different problem (who spoke when among several humans) than rejecting the companion's own echo.

### Cited Findings
**Model**
- Released 2026-09-23. 100M params. 31-layer Transformer encoder with RoPE, plus Conv1D upsampling. Input is 16 kHz mono; mel features at a 10 ms step, stacked x8 into 80 ms frames. Output is a [T, 8] probability tensor at 10 ms resolution. Up to 8 speakers. Speaker order is resolved by arrival order (Sortformer) — [HF model card](https://huggingface.co/nvidia/Nemotron-3-Diarization); [NVIDIA HF blog](https://huggingface.co/blog/nvidia/nemotron-diarization)
- Streaming uses an Arrival-Order Speaker Cache (AOSC) plus a FIFO queue, as in Streaming Sortformer. One checkpoint serves all latency modes. Input-buffer latency can go as low as 80 ms, but the lowest recommended setting is 0.32 s — [search summary of HF card/blog](https://huggingface.co/nvidia/Nemotron-3-Diarization)
- Latency configs (in 80 ms frames): Offline 30.4 s (chunk 340, right context 40, FIFO 40, speaker cache 264), Low 1.04 s (9/4/264/264), Very-low 0.64 s (6/2), Ultra-low 0.32 s (3/1) — [HF model card](https://huggingface.co/nvidia/Nemotron-3-Diarization)
- DER at offline / 1.04 s / 0.32 s: DIHARD III 12.73 / 13.18 / 13.55; CALLHOME-Part2 9.10 / 10.29 / 11.32; AliMeeting near 6.40 / 6.59 / 7.19; AMI SDM 11.14 / 12.80 / 12.95 — [HF model card](https://huggingface.co/nvidia/Nemotron-3-Diarization)
- Against diar_streaming_sortformer_4spk-v2.1: about 40% average relative DER reduction over 8 datasets at 1.04 s (9.0% on CALLHOME-Part2 up to 65.2% on NOTSOFAR1). VoiceArena Diarization-Bench DER 14.72% vs about 19.3% (ranked #1 of 12). DIHARD III offline 12.73 vs 19.09. The gains are largest with more than 4 speakers — [NVIDIA HF blog](https://huggingface.co/blog/nvidia/nemotron-diarization)
- The blog compares only against NVIDIA's own prior Sortformer, not pyannote — [NVIDIA HF blog](https://huggingface.co/blog/nvidia/nemotron-diarization)
- RTFx at batch 1 (eager/compiled, GPU): offline 1340/4385, 1.04 s 38/164, 0.32 s 12.5/54 — [HF model card](https://huggingface.co/nvidia/Nemotron-3-Diarization). Low-latency streaming costs about 35-100x more compute per second of audio than offline mode. On CPU this is the setting that matters.
- Languages: English, Mandarin, Hindi, Kannada, Telugu, Bengali, and multilingual sources — [HF model card](https://huggingface.co/nvidia/Nemotron-3-Diarization)
- Official hardware: NVIDIA A100/H100/L4/L40S/RTX 4090/RTX 6000 Ada/Blackwell, Linux preferred. **No official CPU, ARM or mobile support.** Runtimes: NeMo Speech (PyTorch), NeMo-Speech.cpp, HF Transformers (AutoModelForAudioFrameClassification) — [HF model card](https://huggingface.co/nvidia/Nemotron-3-Diarization); [NVIDIA HF blog](https://huggingface.co/blog/nvidia/nemotron-diarization). The blog mentions Argmax Pro SDK 3 (commercial) for on-device use — [NVIDIA HF blog](https://huggingface.co/blog/nvidia/nemotron-diarization)
- License: OpenMDW License Agreement v1.1, which permits commercial and non-commercial use — [HF model card](https://huggingface.co/nvidia/Nemotron-3-Diarization)

**NeMo-Speech.cpp runtime**
- ggml-based C++ runtime (Apache 2.0 for NVIDIA code). Build presets exist for CUDA, CPU and Metal. Supports Streaming Sortformer and Nemotron 3 Diarization, plus Parakeet/Nemotron ASR, MagpieTTS and others. Uses the GGUF format. The official README does not mention Android explicitly (it does mention ARM/embedded) — [NVIDIA/NeMo-Speech.cpp](https://github.com/NVIDIA/NeMo-Speech.cpp). Nemotron 3 support landed via PR #50 — [PR #50](https://github.com/NVIDIA/NeMo-Speech.cpp/pull/50)
- **Third-party Android proof:** nemo-x-asr-diarizer.cpp (based on NeMo-Speech.cpp) has `scripts/build_android.sh` for arm64-v8a with NDK r26. It ran on an Oppo CPH2371 (Dimensity 1300) on the 2 A78 cores (`taskset`, `--threads 2`) with streaming ASR plus Nemotron-3 diarization. Results: RTF 0.60, peak RSS 375 MB, 0.40 s to first text, speaker turns confirmed about 5 s behind the audio. The Nemotron-3 q8_0 GGUF is 107 MB. A `--diar-session-opt` flag trades latency against RTF — [vieenrose/nemo-x-asr-diarizer.cpp](https://github.com/vieenrose/nemo-x-asr-diarizer.cpp). Third-party claims, not independently verified.

**sherpa-onnx diarization (baseline)**
- Offline pipeline: pyannote-segmentation-3.0 (or reverb-diarization-v1) for segmentation, a speaker-embedding extractor (3D-Speaker, NeMo or WeSpeaker; fp32 and int8 versions), then clustering. Android APKs are available — [sherpa-onnx diarization docs](https://k2-fsa.github.io/sherpa/onnx/speaker-diarization/index.html); [Android APKs](https://k2-fsa.github.io/sherpa/onnx/speaker-diarization/android.html)
- Streaming Sortformer diarization for Android/iOS appears in a react-native-sherpa-onnx PR (StreamingDiarizationWrapper) — [XDcobra PR #124](https://github.com/XDcobra/react-native-sherpa-onnx/pull/124). Whether upstream k2-fsa sherpa-onnx ships a Sortformer ONNX model and a streaming API was **not confirmed** in the docs fetched.

### Inferences
- The S24 Ultra's Cortex-X4 and A720 cores are faster than the Dimensity 1300's A78s, so diarization alone at the 1.04 s setting would plausibly run well below real time on 1-2 cores (**[UNVERIFIED], extrapolated**). It would still compete with Gemma 3 4B for the same big cores and add heat in long sessions.
- The companion's scene is usually 1 human plus 1 TTS voice. Eight-speaker diarization is overkill there. Its "5 s to confirm speaker turns" is too slow for barge-in decisions, which need to be made within about 200-500 ms.
- It might still help for turn-level labeling: after a user utterance ends, checking whether that segment was the companion's voice. The speaker-embedding approach in B2 is cheaper for that.
- An ONNX export of Nemotron 3 Diarization was not documented. The realistic route today is NeMo-Speech.cpp (GGUF, ggml CPU), which means adding a second ggml runtime next to llama.cpp (they may share ggml; **unverified**).

### Gaps
- No official CPU/ARM RTF numbers for Nemotron 3 Diarization.
- Whether upstream NeMo-Speech.cpp builds for Android out of the box (NDK toolchain file, JNI) was not confirmed. Only the third-party fork is proven.
- No head-to-head DER comparison against pyannote 3.x or the sherpa-onnx pipeline was found.
- Streaming Sortformer v2 / v2.1 ONNX availability in sherpa-onnx was not verified.

## B2. Can a speaker embedding, personal VAD or neural AEC reliably reject the companion's own voice and false barge-ins?

### Takeaway
Yes, likely, and cheaply. The companion's voice is a fixed synthetic TTS voice, so it is the ideal enrollment target. Enroll it once with a sherpa-onnx speaker-embedding model (for example titanet-small, 3D-Speaker CAM++ or ERes2Net). At a candidate barge-in, embed the last about 1 s of residual mic audio (after the platform AEC) and veto the barge-in if it matches the TTS voice. For a more robust frame-level gate, personal VAD or own-voice-cancellation research (Interspeech 2026) exists, but no ready-to-ship phone model was found. Classic neural AEC (DTLN-aec) runs on CPU but overlaps with the platform AEC.

### Cited Findings
**Speaker-embedding models in sherpa-onnx (Android APKs available)**
- Available: wespeaker-resnet293 (256-dim), 3D-Speaker CAM++ (512-dim), campplus-zh-en (192-dim), ERes2Net (192-dim), NeMo titanet-small (192-dim, about 40 MB), titanet-large (192-dim, about 101 MB) — [search summary; sherpa-onnx speaker-ID APKs](https://k2-fsa.github.io/sherpa/onnx/speaker-identification/apk.html)
- Prefixes "nemo-", "wespeaker-" and "3dspeaker-" mark the source framework. Android speaker-identification APKs exist — [sherpa-onnx speaker-ID APKs](https://k2-fsa.github.io/sherpa/onnx/speaker-identification/apk.html)
- A user issue reports different results across models, so the choice should be tested — [sherpa-onnx issue #2883](https://github.com/k2-fsa/sherpa-onnx/issues/2883)

**Personal / target-speaker VAD**
- Personal VAD gives per-frame probabilities for non-speech, target-speaker speech and non-target speech, conditioned on a d-vector from enrollment (Google, 2019) — [Personal VAD arXiv 1908.04284](https://arxiv.org/pdf/1908.04284); [Google speaker-id page](https://google.github.io/speaker-id/publications/PersonalVAD/)
- 2026 work: "Adaptive Speaker Embedding Self-Augmentation for Personal VAD with Short Enrollment Speech" (arXiv 2601.12769, Jan 2026) — [arXiv 2601.12769](https://arxiv.org/html/2601.12769). Details and weight availability were not fetched.
- Own-voice cancellation: "Don't Listen to Me" (arXiv 2606.23332, Interspeech 2026) uses enrollment-conditioned TD-SpeakerBeam, with a lighter Mamba-MinGRU masker variant, at 2 ms algorithmic latency. Params, MACs and weight release were not stated in the abstract — [arXiv 2606.23332](https://arxiv.org/pdf/2606.23332)

**Neural AEC**
- DTLN-aec: 10.3M params (512-unit version; 128/256-unit versions also trained). TFLite. 8 ms frame shift; 0.97-3.06 ms per frame on desktop x86. 3rd place in Microsoft's AEC Challenge. Needs the far-end reference signal — [DTLN-aec paper](https://arxiv.org/pdf/2010.14337); [repo](https://github.com/breizhn/DTLN-aec)
- A 2026 lightweight AEC paper: "Echo-Aware Modulation for Compact-Latent Frequency-Time Modeling in Lightweight AEC" (arXiv 2608.03650). Not fetched — [arXiv 2608.03650](https://arxiv.org/pdf/2608.03650)
- Joint personalized speech enhancement plus AEC (2022 baseline) — [arXiv 2211.02773](https://arxiv.org/pdf/2211.02773)

**Barge-in practice**
- WebRTC AEC3 is the named production AEC. It must freeze adaptation during double-talk and needs the reference signal time-aligned to the sample. Silero VAD (1-2 MB) processes a 30 ms chunk in under 1 ms on one CPU thread. The pipeline is layered: VAD, then endpointing, then a semantic turn classifier to ignore backchannels. The interruption decision should take about 200-500 ms total — [runedge.ai blog](https://www.runedge.ai/blog/barge-in-interruption-handling-on-device-voice)
- AEC is tractable because the agent knows exactly what it is playing — [runedge.ai blog](https://www.runedge.ai/blog/barge-in-interruption-handling-on-device-voice)

### Inferences
- **Speaker-embedding veto (recommended first).** The companion has 1-N fixed TTS voices, so enroll each voice's embedding offline from about 30 s of its own TTS output. Also enroll it as heard through the S24 loudspeaker and mic after the platform AEC, because the residual echo is colored by the speaker and the room. At barge-in time (VAD fires and ASR has 3 words), embed the last 0.8-1.5 s. If cos(emb, companion) is above T_self and clearly above cos(emb, user), which is optional if the user is enrolled, veto the barge-in. Keep the existing text-overlap echo check as a second signal. titanet-small (about 40 MB) or CAM++ are the natural choices, run only on candidate events (a few times per minute), so heat cost is negligible.
- **Risk:** residual echo after the platform AEC is often partial or distorted, and double-talk segments mix both voices. Speaker-embedding scores on mixed audio are unreliable, which is why per-frame personal VAD or own-voice extraction exist. Whether a simple embedding veto is "reliable" must be measured (see test). It is not guaranteed.
- **Reference-aware option:** the app generates the TTS itself, so a second-stage DTLN-aec that takes the exact TTS PCM as the far-end reference could remove more residual echo than the platform AEC alone. It costs about 10M params running every 8 ms, which is continuous CPU load and heat. Try it only if the embedding veto plus text-overlap check is not enough. Chaining it after the platform AEC may give poor results because of nonlinear pre-processing (**[UNVERIFIED]**).
- Nemotron 3 Diarization is not the right tool for self-voice rejection: its turn confirmation is too slow and its compute is higher than needed.

### Gaps
- No open, phone-ready personal-VAD or own-voice-cancellation model with released weights was confirmed for 2026. The papers were found, but weights were not verified.
- No published equal-error-rate (EER) figure for the sherpa-onnx speaker models on synthetic TTS voices or on AEC-residual audio.
- The exact sherpa-onnx pretrained speaker-model page returned 404. Sizes other than titanet come from a search summary.

## Concrete first tests

- **Embedding bake-off (1 day).** Export the current notes and synthesize about 300 notes in the same style. Hand-write about 50 (user turn → correct note) pairs plus about 30 near-duplicate pairs. Run BM25, potion-retrieval-32M, granite-97m-multilingual-r2 (ONNX int8), Bekko a25m (ONNX int8) and EmbeddingGemma Q8_0 GGUF at 768 and 256 dims. Report recall@3 and recall@5, and duplicate precision/recall at thresholds 0.85-0.95. On the S24 Ultra, measure per-query latency on 1 big core **while Gemma 3 4B is decoding**, plus total RSS. Decision rule: pick the smallest model within 3 points of the best recall@3.
- **Self-voice veto (half a day).** Record 20 minutes on the S24 in voice-call mode with the platform AEC on: (a) the companion talking alone, (b) the user interrupting, (c) the user talking alone. Label the cases where the current pipeline false-barges. Extract titanet-small and CAM++ embeddings on 1 s windows at every VAD trigger. Plot the score distributions for companion vs user, then choose T_self for 1% false vetoes of real user barge-ins and report the false barge-ins removed. Add the text-overlap check and measure the combined rate.
- **Nemotron 3 Diarization feasibility (optional, 1 day).** Build nemo-x-asr-diarizer.cpp or upstream NeMo-Speech.cpp with `build_android.sh` (arm64, NDK r26). Run the Nemotron-3 q8_0 GGUF alone in the 1.04 s and 0.32 s modes with 1-2 threads. Measure RTF, RSS and skin temperature over 10 minutes with Gemma idle, then with Gemma decoding. Only continue if RTF is below 0.2 and diarization clearly helps multi-person scenes.
- **If the veto is insufficient:** run DTLN-aec TFLite (256-unit) with the TTS PCM as reference, and measure the drop in residual-echo energy and the CPU load per 8 ms frame.
