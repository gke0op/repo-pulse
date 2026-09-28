# companion (working name)

A fully local AI companion for Android: three fixed characters (a girl, a boy, a machine), 3D and voiced,
with no server and a one-time purchase. This repo used to be Repo Pulse; that code lives at `ebf0fba`.

## Status: v0.14 (see `docs/ROADMAP.md` for what changed and why, `docs/AB_TESTS.md` for open A/Bs)

Voice conversation, all on the phone: mic → streaming ASR → LLM → chunker → TTS → audio,
with barge-in (talk over her and she stops), early start at short pauses, per-character long-term
memory, and a thermal governor. Every turn records a timing, RAM, heat and gap trace.

| Stage | Tech | Measured (S24 Ultra unless noted) |
|---|---|---|
| Ears, pass 1 | streaming Zipformer (2023-06-26, int8) + Silero VAD, call-mode mic with platform AEC | live partials, barge-in, end of turn ~0.9 s after last word |
| Ears, pass 2 | Parakeet TDT 0.6B v2 int8 (default) or Canary 180M flash, re-transcribes each utterance | desktop, phone-degraded speech: WER 0% / 4.5% vs 29% for pass 1 |
| Brain | llama.cpp (runtime CPU variant); Gemma 3 4B it Q4_K_M by default, switchable (Llama 3.2 3B, Qwen3 4B 2507, Phi-4 mini, Qwen2.5 1.5B) | persona eval picked Gemma; 1.5B measured ~220 ms first token, ~22 tok/s on phone |
| Chunking | `SentenceChunker` | first chunk at a clause or before a conjunction |
| Voice | Supertonic 3 (default, 2 threads); Kokoro fp32/int8 switchable | RTF 0.40, first audio ~1.0 s after Send |
| Audio | `AudioTrack` float stream | gapless, instant flush for barge-in |
| Face | three.js in a WebView (`web/avatar`): Unit Seven is a procedural shoggoth behind a kintsugi mask; Mira and Kai are VRM humans (downloaded from a pinned commit) or plasma orbs | idle / listening / thinking / speaking, lip-sync from a 20 ms loudness envelope, eyes follow touch |
| Feelings | the brain opens each reply with an emotion tag (prefilled `[`), parsed out of the stream (`EmotionTagStream`) and timed to the chunk it belongs to | 7 feelings: calm, happy, sad, angry, surprised, curious, tender; desktop: Gemma 12/12 tagged, prefill makes any brain comply |

Characters: Mira, Kai, Unit Seven (robot filter). Voices download on demand; the choice is remembered.

## Build

```bash
./scripts/fetch-deps.sh          # llama.cpp source + sherpa-onnx Android libs
./gradlew :app:assembleDebug     # -> app/build/outputs/apk/debug/app-debug.apk
./gradlew :app:testDebugUnitTest # chunker, echo guard, ASR casing
```

Needs the Android SDK with NDK 28.2.13676358 and CMake 3.31.6 (`local.properties` → `sdk.dir`).
APKs are named after the build: `companion-<versionName>-debug.apk`.

On a Mac (as set up 2026-09-28): `brew install openjdk@21 cmake` and
`brew install --cask android-commandlinetools`, then
`sdkmanager --sdk_root=$HOME/Library/Android/sdk "platform-tools" "platforms;android-35" "build-tools;35.0.0" "ndk;28.2.13676358" "cmake;3.31.6"`
(accept the licenses first), and build with
`JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home`. Install and read the
phone over USB: `adb install -r <apk>`, `adb pull /sdcard/Android/data/dev.playground.companion/files/logs`
(memory notes are in `files/memory/`).

The avatar bundle (`app/src/main/assets/avatar/avatar.js`) is committed; after changing `web/avatar/src`:

```bash
cd web/avatar && npm ci && npm run build   # rebuild the bundle
npm run shoot -- /tmp/shots                # headless screenshots of every state (fails on console errors)
```

### Desktop check of the LLM engine

```bash
cmake -S tools/host-test -B /tmp/host-build -G Ninja -DCMAKE_BUILD_TYPE=Release
cmake --build /tmp/host-build && /tmp/host-build/llm_host_test path/to/model.gguf
```

Runs a scripted conversation through the same `llm_engine.cpp` the app uses: memory across turns,
prefix reuse, cancellation, history trims (KV shift), retract/join of cut-off turns, and the
voice-first hold. The same build has:
- `memory_eval model session.md "Name"`: distills a phone session log into memory notes with the app's prompt.
- `recall_eval` + `recall_run.sh`: recall vs invention with the app's exact prompt (dump it with
  `DUMP_PROMPTS_NOTES=<notes dir> ./gradlew :app:testDebugUnitTest --tests '*DumpPromptsTest*'`).
- `drift_eval model system.txt lines.txt`: replays real user lines and prints reply length per turn.

On-device benchmarks: build `llama-bench` from `third_party/llama.cpp` with the app's CMake flags
and the NDK toolchain, push it with `libomp.so`/`libc++_shared.so` to `/data/local/tmp`, and point it
at the model in the app's files dir (see the 2026-09-28 commits for numbers).

## Using the test APK

1. Install, open, tap **Download models** (~1.25 GB, once; resumable).
2. Pick a character, type, send, or tap **Mic** (downloads ~73 MB of speech models once) and talk.
3. **Stop** cuts generation and audio; talking over her does the same.
4. **Models…** switches the brain or recognizer, and benchmarks voices and recognizers (on your last 5 utterances);
   **Copy report** copies all traces.
