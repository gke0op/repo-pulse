# A/B tests on the phone

Each test is two APKs that differ in one thing. Same package and signing key, so installing one
over the other keeps every model, setting and memory. Builds live in `~/Desktop/companion/ab/`.

```bash
adb install -r ~/Desktop/companion/ab/companion-0.14.8-A-debug.apk        # A
adb install -r ~/Desktop/companion/ab/companion-0.14.8-B-voicefirst-debug.apk  # B (test 1)
adb install -r ~/Desktop/companion/ab/companion-0.14.8-B-brief-debug.apk  # B (test 2)
```

How to run one: talk for ~10 minutes on A, then ~10 minutes on B, same character, phone equally
cool at the start of each (thermal status 0-1 in the turn report's `heat` line). Then pull the logs
(`adb pull /sdcard/Android/data/dev.playground.companion/files/logs`) and compare the turn reports.
Say what you *heard*, too: numbers decide speed, your ears decide naturalness.

## 1. Voice first (0.14.8-A vs 0.14.8-B-voicefirst)

- **B:** while the first speech chunk synthesizes, the brain pauses (bounded, 1.5 s max), then
  carries on, **only while the phone is cool** (governor level `cool`). Hot, B behaves like A.
  A: both always run at once (as in every build so far). B's turn reports tag `[voice first]` on
  the TTS line for the turns where it applied.
- **Why:** the first chunk is short (median 2 words, "Seriously?"), yet its synthesis takes ~1.2 s
  on the phone. On the Mac, Supertonic takes 330 ms alone and 1,136 ms next to 4-thread Gemma
  generation: the cost is CPU contention, not the voice. Tonight's 159 turns: first audio 3.4 s =
  first token 1.1 + generating the first chunk 0.85 + synthesizing it 1.35.
- **Expect (inference, untested on phone):** `first chunk synth` drops from ~1.2 s towards ~0.4-0.6 s
  and `first audio` ~0.6-0.8 s earlier. B's reports carry `[voice first]` on the TTS line.
- **The risk, and why B is cool-only:** tonight's 157 multi-chunk turns on A, silence *inside* a
  reply (playing span minus audio) by thermal status: 0-1 none (median -36 ms), 2 0.2 s, 3 **1.8 s**,
  4 **2.5 s**. Hot, the brain writes slower than she speaks (still writing 7.3 s after her first
  word at status 3) and she waits mid-reply. Pausing the brain then would widen those gaps.
- **Measure:** both builds now print `gaps` per turn (silence before each chunk; >=120 ms counts,
  and `after the first chunk` separately). Compare `first audio` AND `gaps` on cool turns.
- **Watch for:** a gap between her first words and the rest (the brain resumes ~0.5 s later, but
  speech is slower than generation, so it should catch up before the first chunk ends).
- **Branches:** A = `claude/deprecated-repo-cleanup-playground-fle50c`, B = `ab/voice-first` (one
  commit on top: `VOICE_FIRST = true` + the version name).

## 2. Brief (0.14.8-A vs 0.14.8-B-brief)

- **B:** every message you send the brain gets a hidden reminder at its end, "(Out loud: one to
  three short sentences.)", or, when you ask for a poem, song, story, something longer or an
  explanation, "(Out loud: this time say the whole thing now, in full, no preamble.)". Your words
  in the transcript and in memory stay as you said them.
- **Why:** replies drift longer as a talk deepens (phone, last night: 26 -> 45 -> 60 -> 72 tokens by
  quarter), and long replies are what stall a hot phone mid-reply. Replaying your 95 real lines to
  Mira on the Mac (`tools/host-test/drift_eval`, raw output in `tools/host-test/results/drift_*`):

  | variant | median tokens by quarter | total | normal replies > 80 tok | poem requests |
  |---|---|---|---|---|
  | A (no reminder) | 26 / 43 / 59 / 78 | 5,356 | 13 | full poems |
  | system-prompt line | 40 / 59 / 68 / 84 | 6,208 | worse | |
  | short reminder only | 31 / 31 / 35 / 36 | 3,237 | 0 | promised, never came |
  | **B-brief** | **30 / 26 / 34 / 45** | **3,744** | **0** | **6/6 full poems** |
- **Your call (ears only):** does she still feel like Mira at this length? Is anything lost in the
  deep talks? Does the phone stay cooler and stall less (`heat`, `gaps`)?
- **Branch:** `ab/brief` (one commit: the two reminder strings + version name).

## Measured and rejected (no A/B needed)

- **Fewer denoising steps** for Supertonic: synth 305 ms (5 steps) -> 231 (4) -> 202 (3) -> 136 (2)
  on the Mac, but Parakeet word errors on the output 1.2% -> 3.6% -> 17.9% -> 22.0% ("Oh, hey there!"
  -> "Oh who they are."). Not worth it.
- **A brevity line in the system prompt:** replies got *longer* (table above).
- **Capping her long replies before memory distillation:** zero fewer distill chunks on tonight's
  three sessions (few replies are long enough to matter).
- **Memory invents details** (fixed in both A and B, 0.14.1): with the app's exact prompt and tonight's
  real notes, 3 samples per question (`tools/host-test/recall_eval`, `recall_questions.txt`,
  raw answers in `tools/host-test/results/`). Inventions on questions the notes can't answer:
  no memory 9, notes v1 11, v2 7, **v3 3** (the memory block now says the notes are all she
  remembers, and that general memories have no details). Recall of what *is* in the notes went
  up, not down. Left over: "What did we say we'd bake?" still gets an invented recipe (3/3); a v4
  line about plans and promises didn't change it (still 3/3, rest unchanged), so it was dropped.
  Likely fix is upstream: distill the specifics ("blueberry crumble pie") into the note itself.

## Next candidates (not built yet)

- **Hot-phone gaps** are the bigger problem (above). Where they come from (75 hot turns): not the
  brain (it finished ~8.6 s before her audio would have ended in 74/75), but the voice: replies run
  long when hot (median 6 chunks, 19 s audio), and a 2-word first chunk plays ~1 s while the next whole
  sentence needs ~3 s to synthesize. `SentenceChunker(rampChunks = n)` (off by default) lets chunks
  2..n+1 break at a clause too. `ChunkingSimTest` (set CHUNK_SIM_LOGS to a logs dir) replays real
  replies: it reproduces first audio (3.28 s sim vs 3.43 s phone) but not silence (1.5 s vs 0.43 s).
  A contention model (synth k x slower while the brain writes) fit worse for every k (best k=1:
  1.26 s). The simulator can't judge the ramp; the phone's `gaps` lines will. (The ramp itself is
  unit-tested: `SentenceChunkerRampTest`.) Ideas to A/B once measured: when the governor
  is `hot`, wait for a whole first sentence instead of a 2-word first chunk (later start, no stall
  after it); ask for shorter replies when hot; or lower `MAX_REPLY_TOKENS` when hot.
