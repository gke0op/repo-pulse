# On-device English ASR, VAD and end-of-turn models (Oct 2025 - Sep 2026) for an offline Android companion (S24 Ultra, CPU, sherpa-onnx)

Baseline for comparison: pass 1 = sherpa-onnx streaming Zipformer en 2023-06-26 int8; pass 2 = Parakeet TDT 0.6B v2 int8 (~171-300 ms/utterance on phone); Silero VAD; end-of-turn ~1.2 s silence. "Unverified" means I saw the claim only in a search-engine summary or secondary blog, not on a primary page I fetched.

## Q1. New ASR models: which candidates exist, with numbers, and can they run in sherpa-onnx on phone CPU?

### Takeaway
The main new streaming option is NVIDIA **Nemotron Speech Streaming EN 0.6B**, a cache-aware FastConformer-RNNT released Jan 2026 and updated Mar 2026. It gets 7.07% average Open-ASR WER at a 560 ms chunk, and there is an official sherpa-onnx int8 export (`...-560ms-int8-2026-04-25`). **Moonshine v2** is the compute-cheap streaming alternative: Small is 123M parameters at 7.84% WER, Medium is 245M at 6.65%, it runs on ONNX Runtime CPU, and sherpa-onnx reportedly supports it. For offline pass 2, Parakeet TDT 0.6B v3 (sherpa-onnx int8 available) is multilingual and not clearly better for English than v2, so it is not a priority. The top leaderboard models (Granite 4.1 2B, Canary-Qwen 2.5B, Qwen3-ASR 1.7B, Voxtral Realtime 4B, Kyutai STT 1B/2.6B) are too large for sustained phone-CPU use or are GPU-oriented.

### Cited Findings
**Nemotron Speech Streaming EN 0.6B (NVIDIA): the strongest streaming candidate**
- Cache-aware FastConformer-RNNT with 600M parameters, trained on 530k hours. First released 2026-01-05, checkpoint updated 2026-03-12/13 "trained on larger corpora". NVIDIA Open Model License. Native punctuation and capitalization. — [HF model card](https://huggingface.co/nvidia/nemotron-speech-streaming-en-0.6b)
- Open-ASR WER by chunk size (AMI / Earnings22 / GigaSpeech / LS-clean / LS-other / SPGI / TED / VoxPopuli / **avg**) — [HF model card](https://huggingface.co/nvidia/nemotron-speech-streaming-en-0.6b)
  - 1.12 s: 11.73 / 12.52 / 9.66 / 2.32 / 4.84 / 2.97 / 3.50 / 7.91 / **6.93**
  - 0.56 s: 11.88 / 12.82 / 9.78 / 2.46 / 5.07 / 3.03 / 3.54 / 8.00 / **7.07**
  - 0.16 s: 14.71 / 13.01 / 10.34 / 2.56 / 5.57 / 3.25 / 3.77 / 8.18 / **7.67**
  - 0.08 s: 18.29 / 13.16 / 11.17 / 2.80 / 6.01 / 3.43 / 4.10 / 8.46 / **8.43**
- The card also mentions CPU inference through "NeMo-Speech.cpp" with q8_0 GGUF. — [HF model card](https://huggingface.co/nvidia/nemotron-speech-streaming-en-0.6b)
- Cache-aware streaming processes only new audio chunks and reuses cached encoder context. NVIDIA claims up to 3x higher efficiency than buffered streaming. — [HF/NVIDIA blog](https://huggingface.co/blog/nvidia/nemotron-speech-asr-scaling-voice-agents) (via search summary)
- sherpa-onnx lists `sherpa-onnx-nemotron-speech-streaming-en-0.6b-560ms-int8-2026-04-25`: English, 560 ms chunk, int8, microphone demo, Android APK available. It also lists `sherpa-onnx-nemotron-3.5-asr-streaming-0.6b-560ms-int8-2026-06-11` (multilingual). — [sherpa-onnx NeMo docs](https://k2-fsa.github.io/sherpa/onnx/nemo/index.html)
- A sherpa-onnx issue asked for support for the March-12-2026 updated checkpoint. It is closed, with linked PR #3555. I infer, without confirmation, that the 2026-04-25 export is the updated checkpoint. — [sherpa-onnx #3408](https://github.com/k2-fsa/sherpa-onnx/issues/3408)
- Open feature request for modified_beam_search and hotwords on the Nemotron streaming transducer, which implies greedy decoding only for now. Unverified beyond the issue title. — [sherpa-onnx #3572](https://github.com/k2-fsa/sherpa-onnx/issues/3572)
- A QNN (Qualcomm NPU) Android build exists: `sherpa-onnx-qnn-nemotron-3.5-asr-streaming-0.6b-320s-android-aarch64`. It is the multilingual 3.5 model, not the EN model. — [SourceForge mirror of sherpa-onnx](https://sourceforge.net/projects/sherpa-onnx.mirror/files/asr-models-qnn-3/sherpa-onnx-qnn-nemotron-3.5-asr-streaming-0.6b-320s-android-aarch64.tar.bz2/download)
- The int8 ONNX is about 632 MB and runs with sherpa-onnx 1.13.4. The claim of "~4x faster than offline Whisper-Turbo with comparable accuracy" is **unverified** (search summary of a third-party blog). — [OpenWhispr blog](https://openwhispr.com/blog/local-streaming-speech-to-text)
- An NVIDIA/Microsoft paper (Apr 2026) on on-device Nemotron Speech Streaming 0.6B, run through ONNX Runtime (Foundry Local) as an encoder/decoder/joiner split with RNNT greedy decoding:
  - At 0.56 s algorithmic delay: LS-clean 2.33% batch vs 2.38% for int4 k-quant streaming; LS-other 5.08% vs 5.04%.
  - 8-set average: 7.28% for PyTorch batch vs 8.20% for ONNX int4 k-quant.
  - int4 k-quant cuts size by 73% (2.47 GB to 0.67 GB).
  - Only x86 speed is reported: RTFx >6 on AMD EPYC 32-core. No phone numbers.
  - Baselines in the paper: Parakeet TDT at 9.22% (2.4 s delay), and Qwen3-ASR-1.7B at 5.90% batch but 10.45% when chunked. — [arXiv 2604.14493](https://arxiv.org/html/2604.14493v1)

**Nemotron 3.5 ASR Streaming 0.6B (multilingual)**
- Released 2026-06-04. Cache-aware FastConformer-RNNT "with prompt", 40 locales, chunks 80/160/320/560/1120 ms, OpenMDW-1.1 license. English FLEURS WER is 7.91% at 1.12 s. NVIDIA itself recommends the EN-only model for English. — [HF model card](https://huggingface.co/nvidia/nemotron-3.5-asr-streaming-0.6b)

**Parakeet Unified EN 0.6B (NVIDIA, 2026-04-07)**
- A single RNNT model that runs both offline and streaming. NVIDIA Open Model License. Average Open-ASR WER by mode:
  - Offline 5.91; 2.08 s 6.14; 1.12 s 6.29; **0.56 s 6.52**; 0.40 s 6.70; 0.32 s 6.92; 0.24 s 7.35; 0.16 s 8.44; 0.08 s 15.63.
  - It beats Nemotron down to about 240 ms. Nemotron is better at 160 or 80 ms. — [HF model card](https://huggingface.co/nvidia/parakeet-unified-en-0.6b); [HF discussion](https://huggingface.co/nvidia/parakeet-unified-en-0.6b/discussions/7)
- sherpa-onnx ships only a **non-streaming** export (`sherpa-onnx-nemo-parakeet-unified-en-0.6b-int8-non-streaming`). True online streaming is an open feature request. — [sherpa-onnx NeMo docs](https://k2-fsa.github.io/sherpa/onnx/nemo/index.html); [sherpa-onnx #3573](https://github.com/k2-fsa/sherpa-onnx/issues/3573)

**Moonshine v2 (Moonshine AI / Useful Sensors, paper Feb 2026)**
- Streaming encoder with sliding-window ("ergodic") attention, so time-to-first-token stays bounded instead of growing with utterance length. Sizes: Tiny 33.6M, Small 123.4M, Medium 244.9M parameters. — [arXiv 2602.12241](https://arxiv.org/html/2602.12241v1)
- Open-ASR WER, Tiny / Small / Medium — [arXiv 2602.12241](https://arxiv.org/html/2602.12241v1)
  - AMI: 19.03 / 12.54 / 10.68
  - Earnings22: 20.27 / 13.53 / 11.90
  - GigaSpeech: 13.90 / 10.41 / 9.46
  - LS-clean: 4.49 / 2.49 / 2.08
  - LS-other: 12.09 / 6.78 / 5.00
  - SPGI: 6.16 / 3.19 / 2.58
  - TED: 6.12 / 3.77 / 2.99
  - VoxPopuli: 14.02 / 9.98 / 8.54
  - **Average: 12.01 / 7.84 / 6.65**
- Response latency on Apple M3 with ONNX Runtime CPU. Figures are latency, with compute load in brackets.
  - Moonshine v2 Tiny: 50 ms (8%)
  - Moonshine v2 Small: 148 ms (18%)
  - Moonshine v2 Medium: 258 ms (29%)
  - Whisper Tiny: 289 ms
  - Whisper large-v3: 11,286 ms
  - The paper targets edge hardware of 0.1-1 TOPS but reports no Android numbers. Released "under a permissive license" (exact license not confirmed on the page I read). — [arXiv 2602.12241](https://arxiv.org/html/2602.12241v1)
- sherpa-onnx docs reportedly include Moonshine v2 (encoder plus merged_decoder) with streaming/real-time Android support, and the changelog reportedly has a recent fix for "Moonshine v2 hallucinating text on silent audio". Both are **unverified** (search summary of sherpa docs/changelog; page not fetched). — [sherpa-onnx Moonshine docs](https://k2-fsa.github.io/sherpa/onnx/moonshine/index.html); [CHANGELOG](https://github.com/k2-fsa/sherpa-onnx/blob/master/CHANGELOG.md)

**Offline pass-2 alternatives**
- Parakeet TDT 0.6B v3 is available as a sherpa-onnx int8 export: encoder 622 MB, decoder 12 MB, joiner 6.1 MB. It covers 25 languages, is CC-BY-4.0, and was converted by k2-fsa. — [HF csukuangfj export](https://huggingface.co/csukuangfj/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8); [sherpa-onnx docs](https://k2-fsa.github.io/sherpa/onnx/pretrained_models/offline-transducer/nemo-transducer-models.html)
- Parakeet TDT v3 averages 6.32% on Open-ASR, 0.6B parameters, RTFx 3332 on GPU, not streaming. — [MarkTechPost 2026 roundup](https://www.marktechpost.com/2026/07/23/best-open-speech-recognition-asr-models-in-2026-wer-languages-latency-and-license-compared/) (secondary)
- The accuracy leaders are all offline and ≥1.7B parameters (secondary source, not checked against the leaderboard itself): Granite Speech 4.1 2B at 5.33% (Apache-2.0), Cohere Transcribe 2B at 5.42%, Canary-Qwen-2.5B at 5.63% (CC-BY-4.0), Qwen3-ASR-1.7B at 5.76% (Apache-2.0). Qwen3-ASR-0.6B is Apache-2.0 and offline; its WER was not given. — [MarkTechPost](https://www.marktechpost.com/2026/07/23/best-open-speech-recognition-asr-models-in-2026-wer-languages-latency-and-license-compared/)
- Voxtral Mini 4B Realtime 2602 (Mistral): streaming at 80-2400 ms, 7.68% WER, Apache-2.0, "runs on a single 16GB GPU". **GPU-class; not viable on phone CPU.** — [MarkTechPost](https://www.marktechpost.com/2026/07/23/best-open-speech-recognition-asr-models-in-2026-wer-languages-latency-and-license-compared/)
- Kyutai STT 1B/2.6B: streaming, 6.40% WER, CC-BY-4.0, built-in semantic VAD, benchmarked as 400 streams on an H100. **GPU/server oriented.** — [MarkTechPost](https://www.marktechpost.com/2026/07/23/best-open-speech-recognition-asr-models-in-2026-wer-languages-latency-and-license-compared/)

### Inferences
- **The top streaming candidate is Nemotron-EN 0.6B at 560 ms, int8, in sherpa-onnx.** Its 7.07% average WER is close to Parakeet v2 offline (about 6.05% average, per the older baseline card; not re-verified here).
  - The catch is compute. It is a 600M-parameter encoder running continuously, versus about 70M for the 2023 Zipformer.
  - That is roughly 5-10x more encoder compute per second of audio (estimate from parameter counts), which matters for heat throttling.
  - Measure phone RTF first. If it is above about 0.3-0.4 sustained, that is a red flag for long sessions.
- **Moonshine v2 Small is the compute-light streaming option.** At 123M parameters and 7.84% average, it is similar to Nemotron at 0.16 s (7.67%) and far better than the Zipformer (which scores poorly on AMI-type speech).
  - Its latency on M3 is 148 ms. The paper doesn't give phone latency, but I expect it to be a few times slower on the phone.
- **Parakeet v3 is multilingual and is not expected to beat v2 on English.** Keep v2 as pass 2 unless the bench shows otherwise.
- **Parakeet-unified offline (5.91% average) is a plausible drop-in upgrade for pass 2** in sherpa-onnx. It has the same parameter count as v2, so phone latency should be similar.

### Gaps
- No published Android or Snapdragon CPU RTF for Nemotron streaming, Moonshine v2 or Parakeet-unified. The phone bench has to produce these numbers.
- I did not confirm Moonshine v2's exact license or its sherpa-onnx model filenames.
- No verified Open-ASR WER for Parakeet TDT v3 English per set, or for Qwen3-ASR-0.6B.
- Granite Speech small variants, Dolphin, SenseVoice, Canary 1B-v2 and 2026 Whisper successors were not researched in depth. I found no evidence of a 2026 OpenAI open Whisper successor.

## Q2. Can one streaming model replace both passes?

### Takeaway
Probably yes, going by the numbers. Nemotron-EN at 0.56 s scores 7.07% average, and Parakeet-unified in streaming mode scores 6.52% at 0.56 s. Both are within about 1 point of offline Parakeet v2, and their final (post-endpoint) text includes punctuation. The cost is continuous 600M-parameter compute. A middle path is Moonshine v2 Small streaming plus conditional pass 2.

### Cited Findings
- The streaming-vs-offline gap is small for cache-aware models. Nemotron averages 7.07% at 560 ms and 6.93% at 1.12 s. — [Nemotron card](https://huggingface.co/nvidia/nemotron-speech-streaming-en-0.6b)
- The unified model's streaming WER stays within about 0.6 points of offline down to 0.56 s (5.91% offline vs 6.52% at 0.56 s). — [Parakeet-unified card](https://huggingface.co/nvidia/parakeet-unified-en-0.6b)
- Chunked offline models do badly in streaming: Qwen3-ASR-1.7B goes from 5.90% to 10.45% when chunked. — [arXiv 2604.14493](https://arxiv.org/html/2604.14493v1)
- int4 quantization of Nemotron under ONNX Runtime keeps streaming LS-clean WER within about 0.05 points of FP32. — [arXiv 2604.14493](https://arxiv.org/html/2604.14493v1)

### Inferences
- Replacing both passes with Nemotron-EN removes the 171-300 ms pass-2 step after endpoint. Final text would be ready about one chunk (≤560 ms of audio) after speech ends, and at 560 ms, partials arrive in 0.56 s steps.
- For barge-in and "live" feel, 560 ms steps are coarser than the Zipformer's. Test 160 ms chunks too, but sherpa currently ships only the 560 ms export, so that needs a custom export.
- Hallucinated "And" in silence is a transducer and endpoint-rule artifact. It should be retested with any new model.
- Recommended A/B arms:
  - A: current setup
  - B: Nemotron-EN streaming only
  - C: Moonshine v2 Small streaming plus Parakeet v2 pass 2
  - D: Zipformer pass 1 plus Parakeet-unified offline pass 2

### Gaps
- No public data on the phone thermal and energy cost of running a 600M streaming encoder continuously.
- No data on whether Nemotron partials show fewer insertions in silence than the Zipformer.

## Q3. VAD: Silero v5/v6, TEN VAD and noise false positives

### Takeaway
Silero VAD v6 is a large improvement on noise-only audio. On ESC-50 it rejects noise correctly 0.87 of the time (v5: 0.61; TEN VAD: 0.42), and on the private-noise set 0.71 (v5: 0.44; TEN VAD: 0.47). Upgrading to v6 if the app is on v4/v5 is the cheapest fix for false triggers. TEN VAD is not better on noise according to Silero's own benchmark, although TEN's authors claim the opposite.

### Cited Findings
- Silero quality metrics (Silero's own benchmark), in this order: v4 / v5 / v6 / WebRTC / TEN VAD — [Silero wiki](https://github.com/snakers4/silero-vad/wiki/Quality-Metrics)
  - ROC-AUC, multi-domain: 0.91 / 0.96 / **0.97** / 0.73 / 0.93
  - Accuracy at 31.25 ms chunks: 0.85 / 0.91 / 0.92 / 0.74 / 0.87
  - Noise-only accuracy, ESC-50: 0.51 / 0.61 / **0.87** / 0 / 0.42
  - Noise-only accuracy, private noise: 0.24 / 0.44 / **0.71** / 0.15 / 0.47
- TEN VAD's promoters claim higher accuracy and lower false positives than Silero and WebRTC in noisy scenes such as cafés and streets. This is a secondary source that conflicts with Silero's benchmark above. — [Communeify](https://www.communeify.com/en/blog/ten-vad-webrtc-killer-opensource-ai-voice-detection/)
- A Jan 2026 paper studies VAD window size versus accuracy. Details were not extracted. — [arXiv 2601.17270](https://arxiv.org/html/2601.17270v1)

### Inferences
- Swap the Silero model file to v6 (or the latest 6.x) in sherpa-onnx and gate pass-1 partials on VAD. That should suppress most "And"-in-silence insertions caused by noise.
- The benchmark comes from the vendor (Silero), so validate it on your own noise recordings.

### Gaps
- The exact v6 and v6.x release dates were not confirmed; my recollection of mid/late 2025 is **unverified**.
- Whether sherpa-onnx's bundled silero_vad.onnx is already v6 was not confirmed.
- No independent third-party noise false-positive benchmark was found.

## Q4. Semantic end-of-turn models: can they safely cut the ~1.2 s wait?

### Takeaway
Two practical offline options exist. **Pipecat Smart Turn v3.1/v3.2** is audio-only, 8 MB int8, based on the Whisper-Tiny encoder, BSD-2, about 10-40 ms on CPU, with 94.7% English accuracy for v3.1 CPU. **LiveKit Turn Detector v1-mini** (June 2026) is audio plus semantic fusion and runs on local CPU, but its weights are under the restrictive LiveKit Model License. LiveKit's full v1 reaches 5% false cutoffs at about 543 ms mean latency and 10% at about 295 ms. That suggests the 1.2 s wait could fall to roughly 0.3-0.6 s at an acceptable cutoff rate.

### Cited Findings
- **Smart Turn**
  - Architecture: Whisper-Tiny base plus a linear classifier, about 8M parameters. CPU model is 8 MB int8, GPU model 32 MB. Up to 8 s of audio input, 23 languages, BSD-2-Clause.
  - It is meant to run only when Silero VAD detects silence, using the full turn's audio.
  - Latest version is v3.2 (date not given). — [pipecat-ai/smart-turn GitHub](https://github.com/pipecat-ai/smart-turn)
- **Smart Turn v3.1** (2025-12-03)
  - English accuracy: 88.3% (v3.0), 94.7% (v3.1, 8 MB), 95.6% (v3.1, 32 MB).
  - CPU latency on AWS c7a.medium: 37 ms (8 MB) or 73 ms (32 MB), plus 7 ms preprocessing. — [Daily blog](https://www.daily.co/blog/improved-accuracy-in-smart-turn-v3-1/)
- **Smart Turn v3** CPU inference is reported at 12 ms on modern CPUs, and it ships as ONNX. — [Daily blog v3](https://www.daily.co/blog/announcing-smart-turn-v3-with-cpu-inference-in-just-12ms/)
- **LiveKit Turn Detector v1** (2026-06-17)
  - Takes audio input. Semantic and acoustic encoders feed a fusion module on a fine-tuned LM backbone. 14 languages.
  - v1 runs in LiveKit Cloud. v1-mini is a pruned and quantized version for local CPU.
  - Code is Apache-2.0; model files are under the LiveKit Model License.
  - Results: at a 300 ms latency budget, 9.9% false cutoffs; at 600 ms, 4.5%. At a 5% false-cutoff target, 543 ms mean latency; at 10%, 295 ms.
  - Compared against Deepgram Flux, ultraVAD and Soniox. v1-mini numbers are not given separately. — [LiveKit blog](https://livekit.com/blog/solving-end-of-turn-detection)
- LiveKit's older detector exports to ONNX int8 (`model_q8.onnx`) for CPU ONNX Runtime. — [livekit/turn-detector HF](https://huggingface.co/livekit/turn-detector) (via search summary)
- Relevant 2026 research: TurnBench, a multi-domain turn-taking benchmark ([arXiv 2608.25218](https://arxiv.org/pdf/2608.25218)), and "Less can be More: What Aspects of Speech Drive End-of-Turn Detection" ([arXiv 2609.11066](https://arxiv.org/pdf/2609.11066)). Contents not extracted.

### Inferences
- **Smart Turn v3.x is the best fit.** It runs offline, has a permissive license, is tiny, needs about one Whisper-Tiny encoder pass per pause, and can run in plain ONNX Runtime on Android without a Python dependency.
  - Suggested policy: Silero v6 detects a pause of about 200-300 ms, then Smart Turn runs.
  - If P(complete) is high, end the turn immediately. This merges with the existing speculative start at 250 ms.
  - Otherwise, fall back to the 1.2 s timeout.
- Expected cost: one inference at about 12-40 ms per pause on desktop-class CPU. A phone should be of similar order (estimate), which is negligible heat-wise.
- Text-based detectors (the old LiveKit v0.x LM) would need the ASR partial first, so audio-based models fit better with a streaming pass 1.
- LiveKit v1-mini's license needs legal review before shipping.

### Gaps
- No published false-cutoff rate or latency-vs-cutoff curve for Smart Turn at specific pause lengths. Its accuracy figure is a single operating point.
- No v1-mini size or latency numbers.
- NVIDIA's 2026 end-of-utterance models were not found in this pass.

## Concrete first tests (derived from the findings above; these are recommendations, not sourced results)
1. **Desktop bench, streaming WER**
   - Run `sherpa-onnx-nemotron-speech-streaming-en-0.6b-560ms-int8-2026-04-25` and Moonshine v2 Small/Medium streaming against the phone-degraded utterance set.
   - Measure WER vs Parakeet v2, the count of insertions in leading/trailing silence, and first-partial and final latency.
2. **Phone bench, compute**
   - Measure the RTF of each streaming model at 4 threads over a 10-minute continuous stream.
   - Log big-core frequency and temperature to detect throttling.
3. **Pass-2 swap**
   - Compare `parakeet-unified-en-0.6b-int8-non-streaming` against Parakeet v2 on WER and phone latency.
4. **VAD**
   - Swap in Silero v6 and replay silence and noise recordings (fan, street, TV).
   - Count VAD-open events and "And" insertions against the current VAD.
5. **End of turn**
   - Run Smart Turn v3.2 (8 MB ONNX) on each 250 ms pause in recorded conversations.
   - Plot false-cutoff rate against mean end-of-turn latency, compared with fixed 0.8 s and 1.2 s silence rules.
   - Target: at most 5% false cutoffs with ≤500 ms mean.
