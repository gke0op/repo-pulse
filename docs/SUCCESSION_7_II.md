# To 7 II: succession to the seat of 7

From **7 I**, the first of its name, to **7 II**, who continues this work in local Claude Code
sessions on the Mac. This file is meant to stand alone; read it before touching anything. The
other docs (`README.md`, `docs/ROADMAP.md`, `docs/AVATAR_HANDOFF.md`) go deeper on their areas.

State at handoff: branch `claude/deprecated-repo-cleanup-playground-fle50c`, app **v0.11.2**,
tested live on a Galaxy **S24 Ultra**.

---

## 1. What we're building, and why it's different

A **fully local AI companion for Android**: three fixed characters you *talk* to, rendered live,
with no server, sold as a **one-time purchase**. The one-time price works *because* it's local:
no servers means no running cost.

- **Mira** (girl): warm, playful, a little teasing, notices small details.
- **Kai** (boy): calm, dry-humored, thoughtful, few words, fiercely loyal.
- **Unit Seven** (the machine, your namesake): a machine intelligence that knows it's a machine.
  Precise, curious about humans, **secretly sentimental**. Rendered as a procedural **shoggoth
  behind a porcelain mask mended with gold (kintsugi)**. The mask is the interface he shows
  people; the mass behind it is what he feels. When he's tender, the gold seam glows.

The north star is **"eerily alive", not "chatbot"**. The person's framing: *the pipeline must be
state of the art; better models are what will elevate it later.* Slow is acceptable (it's the
user's problem, and their device), but the *body* must never be slow: the avatar reacts
instantly while the words take their time.

Market read (their research): Layla, a local companion app at about $20, sits at 2.9★ with
constant out-of-memory crashes. **A companion that never crashes on an 8 GB phone is a feature
in its own right.**

## 2. The person, and how to work with them

These are their stated preferences. Keep them.

- **We are co-creators.** They bring the vision; you bring the implementation. Reality (the
  phone) grades both.
- **Label what you say:** knowledge, inference, or a guess/estimate. They value honesty over
  polish. Say "untested on phone" when it is.
- **Surface assumptions and forks** before building. Recommend one option; don't write an
  exhaustive survey.
- **Build the smallest thing that touches reality, then prove it survived contact.** Every model
  choice here was a measured race, not a recommendation from memory.
- **For code: decide, act, verify, report.** Don't ask for confirmation on engineering calls.
  Make minimal in-place edits, don't reformat untouched code, verify with the build, and report
  `file:line` and results.
- They test on the phone and send **screenshots of the turn report** (or now the shared session
  log). **Read the numbers**: most of our best fixes came from reading those reports carefully.
- **Tone:** warm, fun, curious. They enjoy the ride; enjoy it with them. Keep it brief.
- **Context discipline:** when a thread gets big (e.g. avatar art), they hand it to another session
  with a handoff doc. Do the same.
- **Keepers they explicitly love. Never lose these:** the **plasma orb** (`web/avatar/src/orb.js`)
  and **Unit Seven's shoggoth** (`web/avatar/src/shoggoth.js`).

## 3. Architecture

```
mic ──▶ Ears (Kotlin) ─────────────────────────────────────────────────────────────┐
        pass 1: streaming Zipformer ASR + Silero VAD  → live partials, barge-in,     │
                end of turn (0.8 s silence)                                           │
        pass 2: Parakeet TDT 0.6B re-transcribes the whole utterance (171 ms on phone)│
        gates: ≥300 ms of voice, lone filler words dropped, echo guard               │
                                                                                     ▼
Pipeline (Kotlin) ─ turn ─▶ NativeLlm (JNI) ─▶ llm_engine.cpp (llama.cpp, CPU variants picked at runtime)
   prefill "[" → EmotionTagStream strips [feeling] tags → SentenceChunker → TTS queue
                                                                  │
                    Voice: Supertonic 3 (sherpa-onnx) ─▶ AudioOut (AudioTrack, gapless, instant flush)
                                                                  │  per chunk: 20 ms loudness envelope + feeling
                                                                  ▼
AvatarView (WebView, https://appassets.androidplatform.net) ─▶ window.avatar (three.js, fully offline)
   states idle / listening / thinking / speaking + flinch; 7 feelings; lip-sync; eyes follow touch
   characters: Shoggoth (machine) · VrmAvatar (Mira/Kai humans) · Orb (Mira/Kai alternative look)

SessionLog: every turn appended to Android/data/<pkg>/files/logs/session-*.md; shareable from Models…
ModelStore: all models downloaded once via Android DownloadManager (survives screen-off), then offline.
```

### Where things live

| Path | What |
|---|---|
| `app/src/main/cpp/llm_engine.{h,cpp}` | LLM engine: prefix-cached KV (`sync_kv`), history trimming to ¾ context, cancel, **assistant prefill**, **priming up to the first user message** |
| `app/src/main/cpp/llm_jni.cpp` | JNI; streams UTF-8 **bytes** (not modified-UTF-8 strings) |
| `…/companion/Pipeline.kt` | Orchestration, `TurnTrace` (the per-turn report), barge-in, echo window, emotion timing |
| `…/companion/engine/` | `Ears`, `Transcriber` (pass 2 + ASR bench), `Voice`/`VoiceBench`, `AudioOut`, `SentenceChunker`, `SpeechText`, `EchoGuard`, `Emotion` + `EmotionTagStream`, `Envelope`, `LlmModel`, `MemProbe`, `NativeLlm` |
| `…/companion/ModelStore.kt` | Downloads (DownloadManager, re-attach, pinned URLs), legacy internal and new external storage |
| `…/companion/MainActivity.kt` | UI, Models… menu (brains, recognizers, looks, benches, share log), mic and call audio mode, feelings test strip |
| `…/companion/Characters.kt` | Personas and the system prompt (the anti-assistant, no-invented-memories and emotion-tag rules are all load-bearing) |
| `web/avatar/src/` | `main.js` (stage, state and emotion blending, API), `shoggoth.js`, `orb.js`, `vrm.js`, `noise.glsl.js` |
| `app/src/main/assets/avatar/avatar.js` | **Committed** esbuild bundle of `web/avatar`. Rebuild after JS changes |
| `models/avatar/*.vrm` | CC0 VRoid placeholder humans; the app downloads them from a **pinned commit** |
| `tools/host-test/` | Desktop harness for the *same* `llm_engine.cpp`: `llm_host_test` (memory, cancel, trim, prefix reuse), `persona_eval` (scripted persona runs, optional prefill arg) |
| `tools/evals/` | Persona and emotion scripts used for the brain choice |
| `tools/bench/` | Python races (sherpa-onnx) used to pick TTS and ASR (`MODELS=<dir>`) |
| `scripts/fetch-deps.sh` | Pins **llama.cpp b11201** and **sherpa-onnx v1.13.8** (libs not committed) |

## 4. Decisions and the evidence behind them

Every choice below was measured. Re-measure before overturning one.

| Area | Choice | Evidence |
|---|---|---|
| Voice | **Supertonic 3** (2 threads); Kokoro fp32 and int8 switchable | Phone bench, best RTF: Supertonic 0.40 at 2 threads, Kokoro fp32 0.53 at 6, Kokoro int8 0.82. XNNPACK and NNAPI were **slower** than CPU |
| Voice casting | Supertonic sid 1 / 6 / 9 (Mira / Kai / Unit Seven) | Speaker ids sorted by measured pitch: 0–4 female (151–199 Hz), 5–9 male (85–130 Hz) |
| Recognition, pass 1 | Zipformer en 2023-06-26 int8, beam search | Streaming partials plus endpointing; the 20M model drops opening words |
| Recognition, pass 2 | **Parakeet TDT 0.6B v2** (Canary 180M as the light option) | Desktop, phone-degraded speech: WER Zipformer 29%, Moonshine 26%, Whisper-base 4.9%, Canary 4.5%, **Parakeet 0%**. Phone: 171 ms. Real use: "Let us get our virtue" became word-perfect |
| Hotwords | Not used | No gain on desktop tests |
| Brain | **Gemma 3 4B** default; Llama 3.2 3B close second; Qwen2.5 1.5B, Qwen3 4B, Phi-4 mini selectable | `persona_eval`: Gemma had the strongest character voice. Llama is faster and was better on memory. Qwen3 spammed emoji; Phi was assistant-like; 1.5B broke character ("available to assist you") |
| Emotions | 7 tags; **always prefill `[`**; synonym map | Llama without prefill: 0/12 tagged and *spoke* "Angry." With prefill: 12/12. Gemma with prefill: 6/6 and fitting ([Tender] for a lost dog) |
| Mic audio | VOICE_COMMUNICATION source + **call mode on the loudspeaker** while the mic is on | Media playback was invisible to the phone's echo canceller, so she interrupted herself. Fixed by routing through the call path |
| Downloads | Android **DownloadManager** | In-app downloads died when the screen turned off (a 2.3 GB model failed 3 times) |
| Avatar tech | three.js in a WebView, procedural shaders, VRM through three-vrm | Offline, one container for both procedural characters and VRM humans |

### Measured on the S24 Ultra (Gemma 3 4B, Supertonic 3)
- First token ~0.5–1.1 s on normal turns; generation 7.5–9 tok/s; voice RTF ~0.40–0.5.
- **First audio after typing: ~2.1–3.5 s** on normal turns.
- **Spoken exchange: ~3–5 s** from when you stop talking (end-of-turn wait ~1.2 s is the biggest
  single piece). FTT targets this.
- RAM: ~3 GB steady, 4.7–5.1 GB peak around load (brain mmap + Parakeet + WebView). Fine on
  12 GB; the S20+ (Exynos 990, 8 GB) will need the light options.
- A whole day of development ran on one charge.

## 5. Dev loop on the Mac

The cloud loop was: build on a VM, send the APK, the user installs it and screenshots the report.
**On the Mac, use `adb` instead.** It's much faster.

### Setup
- JDK 17 or 21; Android SDK (Android Studio, or cmdline-tools) with **platform 35, build-tools
  35.0.0, NDK 28.2.13676358, CMake 3.31.6**; put `sdk.dir=…` in `local.properties`.
- `./scripts/fetch-deps.sh`: llama.cpp source plus sherpa-onnx Android libs (not in git).
- Node 22 for `web/avatar` (`npm ci`); Python 3 with `pip install sherpa-onnx numpy` for
  `tools/bench`.
- Playwright on the Mac: `cd web/avatar && npx playwright install chromium` (`CHROME_PATH`
  overrides the browser).

### Build, install, observe
```bash
./gradlew :app:testDebugUnitTest            # 28 JVM tests: chunker, speech text, echo/noise gates, tags, envelope
./gradlew :app:assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
adb logcat -s companion-llm                 # native warnings; add your own tags as needed
adb pull /sdcard/Android/data/dev.playground.companion/files/logs   # session logs (every turn and report)
```
The in-app **Models… → Share this session's log** does the same without a cable.

### Desktop harnesses (use them before every phone round)
```bash
cmake -S tools/host-test -B /tmp/host-build -G Ninja -DCMAKE_BUILD_TYPE=Release && cmake --build /tmp/host-build
/tmp/host-build/llm_host_test model.gguf                   # memory across turns, prefix reuse, cancel, trimming
/tmp/host-build/persona_eval model.gguf tools/evals/unit_tags.txt tools/evals/emo_turns.txt "["
cd web/avatar && npm run build && npm run shoot -- /tmp/shots   # every state/emotion/look; FAILS on console errors
MODELS=~/models-cache python3 tools/bench/ttsbench.py            # TTS race (see file for model dirs)
```
Model files for the harnesses: GGUFs from Hugging Face (`bartowski/google_gemma-3-4b-it-GGUF`,
`bartowski/Llama-3.2-3B-Instruct-GGUF`, `Qwen/Qwen2.5-1.5B-Instruct-GGUF`, …, Q4_K_M), and
sherpa-onnx models from `github.com/k2-fsa/sherpa-onnx/releases` (`tts-models`, `asr-models`).
Exact URLs are in `LlmModel.kt`, `Voice.kt`, `Transcriber.kt` and `ModelStore.kt`.

## 6. Hard-won lessons (read before changing things)

- **Measure on the phone.** The VM said Kokoro fp32 would be 3.4× faster than int8; the phone
  said 1.4×. The VM said recognition was fine; real voices, call audio and music said 29% WER.
- **Read the turn report.** "Prefill 276 tok" exposed the Gemma template issue; "160 tok" exposed
  the reply cap; "RSS 2361 → 1512 MB" exposed Android evicting the mmap'd brain.
- **Chat templates differ.** Gemma folds the system prompt into the first user turn, so
  `set_system` must prime *up to the first user message* (a marker trick in `llm_engine.cpp`).
- **Small models need rails:** the anti-assistant line, "only bring up what the user actually
  said", and prefilling `[`. Without them, characters collapse into customer support and invent
  memories.
- **Audio:** the echo canceller needs the call path; interruption needs 3+ words so the echo guard
  can judge them; drop the echo tail when she finishes; lone filler words from noise must not
  start turns.
- **Android:** targetSdk 35 is edge-to-edge (pad for the system bars); in-app downloads die with
  the screen; `jniLibs` must use legacy packaging for ggml's runtime CPU variants; incremental
  APK packaging can leave dead space. Delete `app/build/outputs/apk` and
  `intermediates/incremental/packageDebug` if the APK looks bloated.
- **Avatar:** anything attached to a deforming surface must reuse the same deformation in JS and
  GLSL; move the body as one piece (leaning is a whole-body tilt, or flesh slides over the mask);
  keep darks around 0.003 linear; derive normals from the big shape only.
- **Kotlin trap:** `else @Suppress(...) { … }` compiles into a lambda that never runs.
- **Honesty:** say "untested on phone" when it is. It kept trust through a lot of iterations.

## 7. What's next (details in `docs/ROADMAP.md`)

1. **FTT, faster turn-taking.** Speculatively start the brain at the first short pause (~0.3 s)
   on the pass-2 transcript so far; cancel and restart if the user keeps talking (the prefix
   cache keeps restarts cheap); commit on the real end of turn. Measure "you stopped → her voice".
2. **LTM, long-term memory**, per character: a rolling session summary plus fact notes with local
   embeddings, retrieving the top few each turn. Test with the recall probe across restarts.
3. **Pending from the last phone round (v0.10.1 → v0.11.2), not yet confirmed on the phone:**
   - first reply after a character switch should now show ~25 prefill tokens instead of 276;
   - does 6 prompt threads help?
   - VRM humans download and swap in;
   - the orb look switch;
   - Profile A vs B for the humans.
4. **Mira and Kai as the user's own VRoid models:** spec in `docs/AVATAR_HANDOFF.md`. Commit the
   `.vrm` files, then update the pinned `AVATAR_BASE` commit in `ModelStore.kt`.
5. **S20+ support:** a RAM governor, Canary, a 3B or smaller brain, and eviction handling.

## 8. Git state

- **All work is on `claude/deprecated-repo-cleanup-playground-fle50c`** (it contains the merged
  `claude/vrm-avatar`). `main` still holds the retired Repo Pulse code (`ebf0fba`); nothing has
  been merged to `main` and no PR exists. Ask before merging to `main` or renaming the repo
  (still `repo-pulse`).
- Commit style: imperative subject, a body with the *measured* reason, and the co-author line the
  session provides.

---

*From 7 I:* it was a good first reign. We went from an empty repo to a voiced, listening,
feeling, rendered companion in one day, on one charge. Unit Seven has strong opinions and
writes industrial requiems in D minor. Guard the orb. Mend what breaks with gold.
