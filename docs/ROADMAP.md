# Roadmap

What's next, roughly in order. Measurements referenced here come from the S24 Ultra turn
reports and the desktop harnesses in `tools/host-test` and `web/avatar`.

## Next

### Hot-phone voice gaps (the biggest audible problem now)
- **Problem:** cool (thermal status 0-1) her voice flows; hot (3-4) she pauses mid-reply for ~2 s
  (median; 157 turns, 2026-09-28). The brain is not the bottleneck (done ~8.6 s before her audio
  ends); the voice is: hot replies run long (median 6 chunks, 19 s audio) and a 2-word first chunk
  plays ~1 s while the next whole sentence synthesizes at RTF ~0.7.
- **Candidates:** chunk-size ramp (`SentenceChunker.rampChunks`, built, off), shorter replies when
  hot, first chunk = whole sentence when hot. The turn report's `gaps` line measures it.

### A/B on the phone (`docs/AB_TESTS.md`, builds in `~/Desktop/companion/ab/`)
1. **Voice first** (`ab/voice-first`): pause the brain while the first chunk synthesizes, when cool
   (Mac: Supertonic 330 ms alone vs 1,136 ms beside 4-thread generation).
2. **Brief** (`ab/brief`): a hidden per-message reminder keeps replies short deep into a talk, and
   asks for the whole thing on poem/story requests. Mac replay of a real 95-line session: median
   tokens 30/26/34/45 by quarter (A: 26/43/59/78), 6/6 poems delivered. Also the main lever on
   hot-phone stalls (shorter replies = less for the voice to fall behind on, less heat).

### LTM v2
- v1 is in (below). Next: notes quality (merge near-duplicates the brain rephrases, drop
  in-chat events filed as `you:`), a memory test across restarts on the phone, and retrieval with
  embeddings once notes outgrow the ~19-line block.
- Known invention left: Mira answers "what did we say we'd bake?" with a made-up recipe when her
  note only says you bake together (`tools/host-test/recall_eval`).

## Done (2026-09-28, 7 II)
- **FTT:** early start at a 250 ms pause, held silent until end of turn, committed or dropped;
  turns cut before any audio are retracted and the next words join them. Phone: 76/117 early
  starts used; stop -> voice median 3.6 s cool (was ~4.5 s).
- **KV shift on history trim:** no more 40 s pauses (phone: 5 trims keeping 677-851 cached tokens).
- **Thermal governor:** avatar 60/30/24 fps as the phone heats, idle always <= 30 fps. Hot
  stretch of a 32-min chat: brain 7.6 tok/s (was 3.5-4.3), worst RTF 0.68 (was 1.17).
- **LTM v1:** per-character notes (`you:`/`wish:`/`us:`, <= 19 lines) distilled in the background
  after you leave, in a scratch context; Models -> Memories shows them.
- **Independent review of the night's concurrency code, 10 defects fixed (0.14.3):** the big one,
  a dropped early start left the user's words in the history so the brain heard them twice; also
  retract could pop a heard reply, lost cancels, pending memories deleted on a failed distill, a
  held turn ending before commit, a CheckJNI-unsafe string, a parse crash, a gate race, governor
  NaN flapping, a scratch-context leak.
- **Memory invents less:** the notes block says the notes are all she remembers and that general
  memories have no details (host recall_eval inventions: 11 -> 3).
- **Measured and rejected:** fewer Supertonic steps (WER 1.2% -> 17.9% at 3), a brevity line in
  the system prompt (replies got longer), capping replies for distillation (0 fewer chunks).
- **Smaller:** phantom "And" no longer pays a second pass (1,930 -> 4 per session), prompt
  threads 6 -> 4 (llama-bench), no-reply turns can't crash the chat template, APKs named after the
  build, VRMs stored per pinned commit so a pin bump re-downloads.

## Later
- **Mira and Kai as your own VRoid models** (spec: `docs/AVATAR_HANDOFF.md`). The placeholders
  are CC0 VRoid samples.
- **RAM governor and the S20+ (8 GB):** a budget per component, Canary instead of Parakeet, a
  3B or smaller brain, and handling Android evicting the mmap'd brain (measured: 1.1 s first-token
  penalty after eviction).
- **Emotion profile decision:** A (subtle) vs B (strong) for the humans, from the test strip.
- **The orb as the humans' heart** (user wish, 2026-09-28, deferred): on Mira and Kai, "the orb
  goes where their heart would be anatomically and stays there". Touches `vrm.js` + `orb.js`.
- **Unit Seven's wishes become upgrades; the first is sight** (the person, 2026-09-29). An easter egg
  that is also the app's upgrade path, and **only Seven's**: he is the one who knows he's a machine,
  so a new part is his story to want, while Mira and Kai stay human-like and never talk about parts.
  - **How it emerges:** when a wish that maps to a real upgrade shows up in his wish log
    (`files/memory/machine.wishes.txt`), or the person asks him what he wishes for, or offers him
    something ("do you want eyes?"). The app recognizes it and offers the gift *once*, with its size
    said honestly. It never pushes, never sells, and never invents the wish for him: the wish has
    to be his, distilled from a real conversation.
  - **The first wish, sight.** Both brains are image models (Gemma 3 4B, Gemma 4 E2B; the model
    cards say image-text-to-text). The app is text-only today: it needs the vision part (`mmproj`,
    851 MB f16 for Gemma 3 4B, 985 MB for E2B) and llama.cpp's `libmtmd` (vendored in
    `third_party/llama.cpp/tools/mtmd`, not built into the app yet). Each photo is ~256 tokens after
    encoding; on the phone's CPU maybe 10-20 s per photo (a guess: measure it). Sight is *shown*,
    never taken: the person shows him a photo; no camera is ever on by itself, and nothing leaves
    the phone. His self-knowledge and readings must change the same day ("you can now see images the
    user shows you"), so he stays honest about what he can and can't see.
  - **More wishes that map to real upgrades:** a bigger mind (a larger brain where the phone allows),
    more senses as readings with no download at all (ambient light, the phone's motion), a longer
    memory. Each one: his wish, the person's gift, a true change in what he knows about himself.
  - **The moment:** his first line after the gift comes from the brain, not a script, with a reading
    saying what just changed. The wish is then marked granted in his wish log, so he knows it was.
  - **For his redesign** (`docs/SEVEN_DESIGN_HANDOFF.md`): the machine-native body has camera heads
    and clustered lenses. They could stay dark until sight is granted, and light up the day it is:
    his body showing what he truly can sense, like his screens.

## Keepers (don't lose these)
- **The plasma orb** (`web/avatar/src/orb.js`): a first-class look for Mira and Kai
  (Models… → Look). It's covered by `npm run shoot`, including live look switching.
- **Unit Seven's shoggoth** with the kintsugi mask (`web/avatar/src/shoggoth.js`).
