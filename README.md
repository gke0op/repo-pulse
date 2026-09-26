# companion (working name)

A fully local AI companion for Android: three fixed characters (a girl, a boy, a machine), 3D and voiced,
with no server and a one-time purchase. This repo used to be Repo Pulse; that code lives at `ebf0fba`.

## Status: v0.6 "ears"

Voice conversation, all on the phone: mic → streaming ASR → LLM → chunker → TTS → audio,
with barge-in (talk over her and she stops). Every turn records a timing and RAM trace.

| Stage | Tech | Measured (S24 Ultra unless noted) |
|---|---|---|
| Ears | sherpa-onnx streaming Zipformer (2023-06-26, int8) + Silero VAD, VOICE_COMMUNICATION mic with platform AEC | RTF 0.095 on desktop; end of turn ~0.9 s after last word |
| LLM | llama.cpp (runtime CPU variant), Qwen2.5-1.5B-Instruct Q4_K_M | first token ~220 ms, ~22 tok/s |
| Chunking | `SentenceChunker` | first chunk at a clause or before a conjunction |
| Voice | Supertonic 3 (default, 2 threads); Kokoro fp32/int8 switchable | RTF 0.40, first audio ~1.0 s after Send |
| Audio | `AudioTrack` float stream | gapless, instant flush for barge-in |

Characters: Mira, Kai, Unit Seven (robot filter). Voices download on demand; the choice is remembered.

## Build

```bash
./scripts/fetch-deps.sh          # llama.cpp source + sherpa-onnx Android libs
./gradlew :app:assembleDebug     # -> app/build/outputs/apk/debug/app-debug.apk
./gradlew :app:testDebugUnitTest # chunker, echo guard, ASR casing
```

Needs the Android SDK with NDK 28.2.13676358 and CMake 3.31.6 (`local.properties` → `sdk.dir`).

### Desktop check of the LLM engine

```bash
cmake -S tools/host-test -B /tmp/host-build -G Ninja -DCMAKE_BUILD_TYPE=Release
cmake --build /tmp/host-build && /tmp/host-build/llm_host_test path/to/model.gguf
```

Runs a scripted conversation through the same `llm_engine.cpp` the app uses: memory across turns,
prefix reuse, cancellation, and history trimming when the context fills.

## Using the test APK

1. Install, open, tap **Download models** (~1.25 GB, once; resumable).
2. Pick a character, type, send, or tap **Mic** (downloads ~73 MB of speech models once) and talk.
3. **Stop** cuts generation and audio; talking over her does the same.
4. **Bench voice** times every downloaded voice; **Copy report** copies all traces.
