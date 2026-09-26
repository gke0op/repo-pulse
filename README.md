# companion (working name)

A fully local AI companion for Android: three fixed characters (a girl, a boy, a machine), 3D and voiced,
with no server and a one-time purchase. This repo used to be Repo Pulse; that code lives at `ebf0fba`.

## Status: v0.1 "spine"

Text in → streaming LLM → speakable chunks → TTS → audio, all overlapped, with a timing and RAM trace for every turn.
No microphone and no avatar yet. This build exists to measure a real phone.

| Stage | Tech | Why |
|---|---|---|
| LLM | llama.cpp (built from source, CPU variants picked at runtime), Qwen2.5-1.5B-Instruct Q4_K_M | mmap'd weights, cached history prefix, cancellable |
| Chunking | `SentenceChunker` | first chunk splits at a clause so the voice starts early |
| TTS | sherpa-onnx + Kokoro-82M int8 | natural voice, 11 speakers, Apache 2.0 |
| Audio | `AudioTrack` float stream | gapless playback, instant flush for barge-in |

Characters: Mira (Kokoro `af_bella`), Kai (`am_michael`), Unit Seven (`bm_george` + ring-mod robot filter).

## Build

```bash
./scripts/fetch-deps.sh          # llama.cpp source + sherpa-onnx Android libs
./gradlew :app:assembleDebug     # -> app/build/outputs/apk/debug/app-debug.apk
./gradlew :app:testDebugUnitTest # chunker tests
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

1. Install, open, tap **Download models** (~1.2 GB, once; resumable).
2. Pick a character, type, send. **Stop** cuts generation and audio.
3. **Copy report** puts per-turn timings (first audio, tok/s, TTS RTF, RAM) on the clipboard.
