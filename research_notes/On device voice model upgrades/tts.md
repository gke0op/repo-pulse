# On-device TTS candidates (Oct 2025 - Sep 2026) to replace/complement Supertonic 3 on a Galaxy S24 Ultra CPU

Baseline (from the brief, not re-verified here): Supertonic 3 int8 via sherpa-onnx, 2 threads, RTF ~0.4-0.5 cool / 0.7-1.0 throttled, 5 flow-matching steps (WER 1.2% at 5 vs 17.9% at 3), ~1.0-1.3 s for a 2-word first chunk with the 4B LLM running. Kokoro 82M RTF 0.53-0.82.

## Q1. Which new or updated small TTS models exist, and what are their specs (params, architecture, quality, control, cloning, streaming, CPU speed, ONNX/sherpa-onnx, license)?

### Takeaway
The real new small CPU options in this window are **Kyutai Pocket TTS (100M, Jan 2026, streaming, voice cloning, already in sherpa-onnx with an Android cloning demo)**, **Kitten TTS 0.8 (14/40/80M, Mar 2026, Apache-2.0 code, English, 8 voices)**, **Soprano 1.1-80M (Jan 2026, Apache-2.0, streaming, single voice)**, **NeuTTS Nano (~117M active, GGUF, cloning)** and **Chatterbox Turbo (350M, MIT, the only small model with working paralinguistic/emotion tags, but heavy on CPU)**. Supertonic 3 (Apr 29 2026) is itself the newest Supertonic; nothing newer found. Pocket TTS is the strongest "complement" candidate; its license needs checking before shipping.

### Cited Findings

**Supertonic 3 (current baseline; the newest Supertonic)**
- Released April 29, 2026: 31 languages, better reading accuracy, fewer repeat/skip failures, "v2-compatible public ONNX assets" — [Supertonic README](https://github.com/supertone-inc/supertonic/blob/main/README.md)
- ~99M params across public ONNX assets; 6 preset voice styles (M3, M4, M5, F3, F4, F5) — [HF Supertonic-3](https://huggingface.co/Supertone/supertonic-3); [README](https://github.com/supertone-inc/supertonic/blob/main/README.md)
- Inline expression tags: README says 10 tags "including `<laugh>`, `<breath>`, `<sigh>`" (non-verbal sounds, not emotion styles) — [README](https://github.com/supertone-inc/supertonic/blob/main/README.md); [HF card](https://huggingface.co/Supertone/supertonic-3); [MarkTechPost](https://www.marktechpost.com/2026/05/15/supertone-releases-supertonic-v3-on-device-text-to-speech-model-with-31-language-support-fewer-reading-failures-and-expression-tags/)
- Speed: average RTF 0.3 on an Onyx Boox Go 6 e-reader (airplane mode); no Android phone numbers published — [README](https://github.com/supertone-inc/supertonic/blob/main/README.md)
- **Voice Builder (custom voice embeddings) is archived and "no longer accessible after August 31, 2026"** — this closes the path to custom Supertonic voices for new characters — [README](https://github.com/supertone-inc/supertonic/blob/main/README.md)
- License: sample code MIT, model OpenRAIL-M (use-based restrictions; commercial use allowed subject to those terms) — [HF card](https://huggingface.co/Supertone/supertonic-3)
- sherpa-onnx has `sherpa-onnx-supertonic-tts-int8-2026-03-06` (dated before the v3 release, so presumably Supertonic 2; unverified which version) — [HF](https://huggingface.co/csukuangfj2/sherpa-onnx-supertonic-tts-int8-2026-03-06)
- No streaming mentioned in the docs — [README](https://github.com/supertone-inc/supertonic/blob/main/README.md)

**Kyutai Pocket TTS (Jan 13 2026)**
- 100M params; runs on CPU; ~200 ms to first audio chunk; ~6x real-time (RTF ~0.17) on a MacBook Air M4 CPU "using only 2 CPU cores"; streaming output; infinitely long input — [HF kyutai/pocket-tts](https://huggingface.co/kyutai/pocket-tts); [GitHub](https://github.com/kyutai-labs/pocket-tts)
- Architecture: Kyutai's Delayed Streams Modeling line (text tokens and continuous speech latents in one model); paper ref arXiv 2509.06926 — [HF card](https://huggingface.co/kyutai/pocket-tts); [Medium summary (secondary)](https://medium.com/@cooksusan482/kyutai-pocket-tts-100m-parameter-that-runs-on-your-cpu-6cae1fd812bf)
- Voice cloning from a plain WAV; voice states can be exported to safetensors to skip recomputation (good for fixed character voices) — [GitHub](https://github.com/kyutai-labs/pocket-tts)
- Languages: EN, FR, DE, PT, IT, ES (24-layer variants for non-English); community models for more — [GitHub](https://github.com/kyutai-labs/pocket-tts); [HF card](https://huggingface.co/kyutai/pocket-tts)
- No formal WER/MOS numbers in the docs — [HF card](https://huggingface.co/kyutai/pocket-tts)
- sherpa-onnx: `sherpa-onnx-pocket-tts-int8-2026-01-26` (exported with KevinAHM/pocket-tts-onnx-export), C API example exists, and an Android Compose PocketTTS voice-cloning demo PR — [HF sherpa model](https://huggingface.co/csukuangfj2/sherpa-onnx-pocket-tts-int8-2026-01-26); [C API example](https://github.com/k2-fsa/sherpa-onnx/blob/master/c-api-examples/pocket-tts-en-c-api.c); [PR #3773](https://github.com/k2-fsa/sherpa-onnx/pull/3773)
- Open issue: Pocket TTS voice cloning sounds audibly different in sherpa-onnx vs the original library; no cause/fix yet — [Issue #3180](https://github.com/k2-fsa/sherpa-onnx/issues/3180)
- Vendor benchmark (Ryzen 7 5700X desktop): Pocket first-token-to-speech 1,713 ms, 610 MB peak memory, 242 MB model, core-hour ratio 0.37x (vs Kokoro 3,658 ms / 2.0 GB / 341 MB / 1.28x) — [Picovoice benchmark, Jul/Aug 2026 — vendor of competitor Orca](https://picovoice.ai/blog/on-device-tts/)
- **License — CONFLICTING, must verify:** code MIT with a prohibited-use list (no cloning without consent, no deception) — [GitHub](https://github.com/kyutai-labs/pocket-tts); weights CC-BY-4.0 per HF card (gated: share contact info) — [HF card](https://huggingface.co/kyutai/pocket-tts); but the sherpa-onnx int8 export card says "It is for non-commercial" use — [sherpa HF card](https://huggingface.co/csukuangfj2/sherpa-onnx-pocket-tts-int8-2026-01-26); a third-party app lists Pocket as Apache-2.0 — [HayaiTTS](https://github.com/HayaiApp/HayaiTTS/tree/main)

**Kitten TTS 0.8 (Mar 2026)**
- Three new models Mar 2026: 80M (mini, 80 MB), 40M (micro, 41 MB), 14-15M (nano, 25 MB int8); int8+fp16 ONNX; English only; 8 voices (Bella, Jasper, Luna, Bruno, Rosie, Hugo, Kiki, Leo); speed multiplier only — [GitHub KittenTTS](https://github.com/KittenML/KittenTTS); [Show HN](https://news.ycombinator.com/item?id=47441546)
- Speed: ~1.5x real-time (RTF ~0.67) for the 80M model on an Intel 9700 desktop CPU — [Show HN, developer](https://news.ycombinator.com/item?id=47441546)
- No emotion control ("being explored"); users report numbers can sound "just like noise"; some voices "anime/cartoon-ish" — [Show HN](https://news.ycombinator.com/item?id=47441546)
- Picovoice desktop bench: Kitten Nano FTTS 10,483 ms, core-hour ratio 3.1x (slow despite size) — [Picovoice](https://picovoice.ai/blog/on-device-tts/)
- License: Apache-2.0 for code; weights' license not stated in README — [GitHub](https://github.com/KittenML/KittenTTS). Mobile SDK "planned" — same source. Kitten is in sherpa-onnx (Android app ships it) — [HayaiTTS](https://github.com/HayaiApp/HayaiTTS/tree/main)

**Soprano 80M / 1.1-80M (Dec 22 2025 / Jan 14 2026)**
- 80M, 32 kHz, English, single speaker, no cloning, no emotion control; ~20x real-time on CPU, streaming <250 ms first audio on CPU; Apache-2.0 weights+code; trained on only ~1,000 h so uncommon words may be mispronounced; v1.1 claims 95% fewer hallucinations — [HF Soprano-80M](https://huggingface.co/ekwek/Soprano-80M); [efficient coder summary](https://www.xugj520.cn/en/archives/soprano-tts-real-time-voice-synthesis-2.html)
- ONNX availability not stated; not seen in sherpa-onnx — [HF](https://huggingface.co/ekwek/Soprano-80M)

**NeuTTS Air / NeuTTS Nano (Neuphonic)**
- Air: 0.5B LLM backbone speech LM, instant cloning, GGML/GGUF for phones — [HF neutts-air](https://huggingface.co/neuphonic/neutts-air)
- Nano: ~116.8M active / ~228.7M total params, NeuCodec single-codebook codec (24 kHz), cloning from 3-15 s reference, watermarked output, Q8/Q4 GGUF, EN plus separate ES/FR/DE models; license listed as "other" (gated) — [HF neutts-nano](https://huggingface.co/neuphonic/neutts-nano); [Q4 GGUF](https://huggingface.co/neuphonic/neutts-nano-q4-gguf)
- No published phone RTF — [HF neutts-nano](https://huggingface.co/neuphonic/neutts-nano)

**Chatterbox Turbo (Resemble AI, late 2025)**
- 350M backbone; speech-token-to-mel decoder cut from 10 steps to 1; MIT; Perth watermark embedded; English (multilingual variant separate); zero-shot cloning from ~5 s — [HF chatterbox-turbo](https://huggingface.co/ResembleAI/chatterbox-turbo); [Resemble](https://www.resemble.ai/learn/models/chatterbox-turbo)
- Official ONNX export exists — [HF chatterbox-turbo-ONNX](https://huggingface.co/ResembleAI/chatterbox-turbo-ONNX)
- Tags: 9 sound tags audibly work ([laugh] [chuckle] [gasp] [cough] [sigh] [groan] [sniff] [shush] [clear throat]); 10 emotion/delivery tags ([whispering] [angry] [fear] [surprised] [crying] [happy] [sarcastic] [dramatic] [narration] [advertisement]) had no effect in mlx-audio, but reporter says all 19 work under ONNX runtime — [Issue #557](https://github.com/resemble-ai/chatterbox/issues/557)
- CPU cost: Picovoice desktop bench FTTS 48,281 ms, 7.5 GB peak memory, 2,980 MB model, core-hour ratio 13.4x — [Picovoice](https://picovoice.ai/blog/on-device-tts/)

**Qwen3-TTS 0.6B (Alibaba, Jan 2026)**
- 12 Hz codec LM; 0.6B and 1.7B Base (cloning) and CustomVoice (9 speakers) checkpoints; all 12 Hz checkpoints stream; 10 languages; Apache-2.0; instruction control of emotion/pace/tone is stronger in 1.7B than 0.6B — [Qwen blog](https://qwen.ai/blog?id=qwen3tts-0115); [HF 0.6B-CustomVoice](https://huggingface.co/Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice); [GitHub](https://github.com/QwenLM/Qwen3-TTS)

**VibeVoice-Realtime-0.5B (Microsoft)**
- Qwen2.5-0.5B LLM + ~340M acoustic decoder + ~40M diffusion head (≈0.9B total), streaming text input, ~200-300 ms first audio (hardware-dependent), English primary; community ONNX (Olive/onnxruntime-genai) CPU fp32/int4 exports — [Microsoft docs](https://github.com/microsoft/VibeVoice/blob/main/docs/vibevoice-realtime-0.5b.md); [ONNX community](https://huggingface.co/onnx-community/VibeVoice-Realtime-0.5B-Onnx)

**Leaderboard context (Artificial Analysis open-weights Speech Arena, 2026)**
- Breeze TTS 2 1206, Fish S2 Pro 1119, Step Audio EditX 1095, Voxtral TTS 1080, **Kokoro 82M v1.0 1065**, NVIDIA Magpie-Multilingual 357M 1064, Maya1 1046, OpenAudio S1 Mini 1042, Higgs Audio V3 1037, **Chatterbox 1023**, Zonos v0.1 1000, VibeVoice 1.5B 954 … StyleTTS2 893. Supertonic, Pocket TTS, Kitten, Soprano, NeuTTS not listed — [Artificial Analysis](https://artificialanalysis.ai/text-to-speech/leaderboard/provider-voice/open-weights)
- Kokoro is still the highest-ranked sub-100M model there; everything above it is far larger — same source.

**sherpa-onnx ecosystem**
- An Android app built on sherpa-onnx ships Piper / Kokoro / Kitten / Matcha / ZipVoice / Pocket / Supertonic families, confirming all run on Android via sherpa-onnx; it says synthesis is "sub-second on a 2020+ phone" (no RTF) and that its streaming playback still buffers full audio — [HayaiTTS](https://github.com/HayaiApp/HayaiTTS/tree/main)
- ZipVoice-distill int8 zero-shot cloning measured RTF ~1.0 on a Pixel 10 Pro CPU (too slow for us) — [sherpa-onnx issue #3439 via search snippet](https://github.com/k2-fsa/sherpa-onnx/issues/3439)

### Inferences
- Pocket TTS is the only new model that combines: sherpa-onnx support, true streaming, cloning (lets us build the three character voices from our own recorded/licensed reference clips), and a 2-core design close to our 2-thread budget. If M4 RTF ~0.17 on 2 cores, an S24 Ultra (Snapdragon 8 Gen 3 / Cortex-X4) might land around RTF 0.3-0.5 — speculative, must measure.
- Supertonic 3 remains the multilingual/fast baseline, but losing Voice Builder means we are stuck with 6 presets; for a "warm young woman / calm young man" that may suffice, but Pocket/Kokoro give more voice choice.
- Kitten 80M quality/speed (~RTF 0.67 desktop) does not beat Kokoro and has no emotion control; low priority except the 14M nano as an ultra-cheap fallback when throttled (but Picovoice bench suggests it is not actually fast).
- Chatterbox Turbo, VibeVoice, Qwen3-TTS 0.6B, NeuTTS Air are too heavy (0.35-0.9B+ plus codec decoders) to run alongside a 4B LLM on a phone CPU without thermal collapse; treat as desktop-only references.

### Gaps
- No verified phone (Android ARM) RTF for Pocket TTS, Kitten 0.8, Soprano, or NeuTTS Nano; all numbers are desktop/M4.
- Pocket TTS weights license is contradictory (CC-BY-4.0 vs "non-commercial" vs Apache-2.0 in secondary sources). Read the LICENSE file on the HF repo before committing.
- Kitten weights license not stated in README; NeuTTS Nano license is "other" (content gated) — terms not read.
- Not researched/verified this session (no sources fetched): Kokoro updates after v1.0, Piper successors, Sesame CSM-1B, Dia, Orpheus small variants, Kyutai TTS 1.6B, Zonos, MeloTTS, Spark-TTS, Llasa, Index-TTS, F5/E2 small, Marvis TTS, KaniTTS. From general knowledge most are 0.5B+ codec-LMs (GPU-oriented) — unverified.
- Exact list of Supertonic 3's 10 tags not retrieved (only laugh/breath/sigh confirmed).

## Q2. Which support emotion/style control we could drive from our 7 tags (calm, happy, sad, angry, surprised, curious, tender)?

### Takeaway
No small (<150M) CPU model found offers true emotion-style tags. Supertonic 3 and Chatterbox Turbo offer non-verbal sound tags; Chatterbox Turbo's emotion tags reportedly work only under ONNX; Qwen3-TTS offers instructed emotion but mostly at 1.7B. The practical route on phone is **reference-audio emotion via cloning (Pocket TTS)**: pre-compute one voice state per character x emotion from emotional reference clips.

### Cited Findings
- Supertonic 3: 10 inline tags incl. `<laugh>`, `<breath>`, `<sigh>` — [README](https://github.com/supertone-inc/supertonic/blob/main/README.md)
- Chatterbox Turbo: [happy], [angry], [surprised], [crying], [whispering] etc. tokenized; audible in ONNX per reporter, silent in mlx-audio — [Issue #557](https://github.com/resemble-ai/chatterbox/issues/557)
- Qwen3-TTS CustomVoice/VoiceDesign take instructions for emotion, pace, tone; 1.7B much stronger than 0.6B — [Qwen blog](https://qwen.ai/blog?id=qwen3tts-0115); [therundown summary](https://www.therundown.ai/tools/qwen3-tts)
- Kitten TTS: no emotion control — [Show HN](https://news.ycombinator.com/item?id=47441546); Soprano: none, single voice — [HF](https://huggingface.co/ekwek/Soprano-80M)
- Pocket TTS: voice cloning from WAV with exportable voice states (no explicit emotion API) — [GitHub](https://github.com/kyutai-labs/pocket-tts)

### Inferences
- Cheap mapping available today with Supertonic 3: happy→occasional `<laugh>`, sad→`<sigh>`, tender/calm→`<breath>` + slower speed; surprised/curious via punctuation and speed. This is prosody seasoning, not emotional voice.
- Pocket TTS cloning inherits the reference clip's style (typical of in-context cloning models; not confirmed for Pocket specifically), so 3 characters x 7 emotions = 21 cached voice states is plausible and cost-free at runtime.

### Gaps
- No measured evidence of how strongly Pocket TTS transfers emotion from reference audio.
- Whether Supertonic 3 tags work in the sherpa-onnx frontend (vs Supertone's own SDK) is unverified.

## Q3. Which are realistic on a phone CPU alongside a 4B LLM (heat)?

### Takeaway
Realistic: Supertonic 3 (~99M), Pocket TTS (100M, 2-core design), Kokoro (82M), Kitten (14-80M), Soprano (80M, but no ONNX/sherpa path). Borderline: NeuTTS Nano (~229M total, GGUF). Not realistic: Chatterbox Turbo (350M; 7.5 GB peak / 13.4x core-hour on desktop), VibeVoice-Realtime (~0.9B), Qwen3-TTS, NeuTTS Air (0.5B+).

### Cited Findings
- Pocket TTS uses 2 CPU cores, RTF ~0.17 on M4 — [HF card](https://huggingface.co/kyutai/pocket-tts)
- Desktop vendor bench, core-hour ratio (lower = cheaper): Piper 0.35x, Pocket 0.37x, Kokoro 1.28x, Kitten Nano 3.1x, Chatterbox Turbo 13.4x; peak memory Pocket 610 MB vs Kokoro 2.0 GB vs Chatterbox 7.5 GB — [Picovoice (vendor)](https://picovoice.ai/blog/on-device-tts/)
- Supertonic 3 RTF 0.3 on an e-reader-class device — [README](https://github.com/supertone-inc/supertonic/blob/main/README.md)
- ZipVoice-distill cloning RTF ~1.0 on Pixel 10 Pro — [sherpa-onnx #3439 snippet](https://github.com/k2-fsa/sherpa-onnx/issues/3439)

### Inferences
- Pocket TTS's streaming changes the latency picture more than raw RTF: ~200 ms first chunk on M4 vs our ~1.0-1.3 s for a 2-word Supertonic chunk. Even at 3x slower on a throttled phone, first audio could be ~0.6 s (speculative).
- Picovoice numbers are from a competitor vendor with no quality metrics; use them only for relative CPU cost.

### Gaps
- No thermal/sustained-load measurements for any candidate on Snapdragon devices.

## Q4. Concrete first tests per top candidate (desktop sherpa-onnx RTF+Parakeet WER bench, then phone bench)

### Takeaway
A/B set: (1) Supertonic 3 baseline, (2) Pocket TTS int8 via sherpa-onnx, (3) Kokoro as the quality anchor; optional (4) Kitten 0.8 mini/nano as a throttle fallback. Chatterbox Turbo only as a desktop reference for emotion tags.

### Cited Findings
- Pocket TTS int8 sherpa package and C/Kotlin APIs exist — [HF](https://huggingface.co/csukuangfj2/sherpa-onnx-pocket-tts-int8-2026-01-26); [PR #3773](https://github.com/k2-fsa/sherpa-onnx/pull/3773)
- sherpa vs original Pocket output differs (open issue) — [Issue #3180](https://github.com/k2-fsa/sherpa-onnx/issues/3180)
- Kitten struggles with numbers — [Show HN](https://news.ycombinator.com/item?id=47441546)

### Inferences (proposed tests)
- **Pocket TTS**: desktop bench with `sherpa-onnx-pocket-tts-int8-2026-01-26`, 2 threads; measure RTF, time-to-first-chunk (streaming callback), Parakeet WER on the existing sentence set including numbers/abbreviations. Clone 3 character voices from consented/licensed 10-20 s clips; then 7 emotion clips for one character to test emotion transfer (listen + WER). Compare against the original PyTorch pocket-tts on the same reference to quantify issue #3180. Phone: same with LLM running, log RTF over 10 minutes for thermal drift. Gate: license check first.
- **Supertonic 3 tags**: in the current pipeline, run the 7-emotion sentence set with/without `<laugh>/<sigh>/<breath>` insertion; check WER does not regress and tags actually render in sherpa-onnx.
- **Kokoro**: already benchmarked; re-run in the same session for a fair side-by-side on WER, RTF, and blind preference for the two human voices.
- **Kitten 0.8 (mini 80M, nano int8)**: desktop RTF/WER, especially number-heavy lines; only promote if WER near Supertonic and RTF <0.4 on phone.
- **Chatterbox Turbo ONNX (desktop only)**: verify whether [happy]/[angry]/[surprised] tags audibly work under ONNX (issue #557 claim) — informs whether any small tag-driven emotion model is worth waiting for.

### Gaps
- None of these tests have been run; all phone performance expectations are extrapolated.
