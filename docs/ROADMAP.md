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

### A/B on the phone: voice first (`docs/AB_TESTS.md`)
- Pause the brain while the first chunk synthesizes, when cool. Builds in `~/Desktop/companion/ab/`.

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

## Keepers (don't lose these)
- **The plasma orb** (`web/avatar/src/orb.js`): a first-class look for Mira and Kai
  (Models… → Look). It's covered by `npm run shoot`, including live look switching.
- **Unit Seven's shoggoth** with the kintsugi mask (`web/avatar/src/shoggoth.js`).
