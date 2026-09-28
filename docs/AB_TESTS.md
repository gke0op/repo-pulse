# A/B tests on the phone

Each test is two APKs that differ in one thing. Same package and signing key, so installing one
over the other keeps every model, setting and memory. Builds live in `~/Desktop/companion/ab/`.

```bash
adb install -r ~/Desktop/companion/ab/companion-0.14.1-A-debug.apk        # A
adb install -r ~/Desktop/companion/ab/companion-0.14.1-B-voicefirst-debug.apk  # B
```

How to run one: talk for ~10 minutes on A, then ~10 minutes on B, same character, phone equally
cool at the start of each (thermal status 0-1 in the turn report's `heat` line). Then pull the logs
(`adb pull /sdcard/Android/data/dev.playground.companion/files/logs`) and compare the turn reports.
Say what you *heard*, too: numbers decide speed, your ears decide naturalness.

## 1. Voice first (0.14.1-A vs 0.14.1-B-voicefirst)

- **B:** while the first speech chunk synthesizes, the brain pauses (bounded, 1.5 s max), then
  carries on. A: both run at once (as in every build so far).
- **Why:** the first chunk is short (median 2 words, "Seriously?"), yet its synthesis takes ~1.2 s
  on the phone. On the Mac, Supertonic takes 330 ms alone and 1,136 ms next to 4-thread Gemma
  generation: the cost is CPU contention, not the voice. Tonight's 159 turns: first audio 3.4 s =
  first token 1.1 + generating the first chunk 0.85 + synthesizing it 1.35.
- **Expect (inference, untested on phone):** `first chunk synth` drops from ~1.2 s towards ~0.4-0.6 s
  and `first audio` ~0.6-0.8 s earlier. B's reports carry `[voice first]` on the TTS line.
- **Watch for:** a gap between her first words and the rest (the brain resumes ~0.5 s later, but
  speech is slower than generation, so it should catch up before the first chunk ends).
- **Branches:** A = `claude/deprecated-repo-cleanup-playground-fle50c` @ 246e001, B = `ab/voice-first`
  @ 7042f04 (one line: `VOICE_FIRST = true`).

## Measured and rejected (no A/B needed)

- **Fewer denoising steps** for Supertonic: synth 305 ms (5 steps) -> 231 (4) -> 202 (3) -> 136 (2)
  on the Mac, but Parakeet word errors on the output 1.2% -> 3.6% -> 17.9% -> 22.0% ("Oh, hey there!"
  -> "Oh who they are."). Not worth it.
- **Capping her long replies before memory distillation:** zero fewer distill chunks on tonight's
  three sessions (few replies are long enough to matter).
- **Memory invents details** (fixed in both A and B, 0.14.1): with the app's exact prompt and tonight's
  real notes, 3 samples per question (`tools/host-test/recall_eval`, `recall_questions.txt`,
  raw answers in `tools/host-test/results/`). Inventions on questions the notes can't answer:
  no memory 9, notes v1 11, v2 7, **v3 3** (the memory block now says the notes are all she
  remembers, and that general memories have no details). Recall of what *is* in the notes went
  up, not down. Left over: "What did we say we'd bake?" still gets an invented recipe (3/3).
