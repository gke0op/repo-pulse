# Roadmap

What's next, roughly in order. Measurements referenced here come from the S24 Ultra turn
reports and the desktop harnesses in `tools/host-test` and `web/avatar`.

## Next

### FTT: faster turn-taking
- **Problem:** after you stop talking, the reply waits for the end-of-turn silence (0.8 s rule plus
  VAD tail, measured ~1.2 s), then the second-pass recognizer, then the brain. With Gemma 4B,
  spoken exchanges land at ~3–5 s.
- **Plan:** start the brain speculatively at the first short pause (~0.3 s), using the second-pass
  transcript of the audio so far. If you keep talking, cancel and restart (the KV prefix is
  reused, so a restart is cheap). Commit when the full end-of-turn fires and the text matches.
- **Measure:** "you stopped → her voice" in the turn report, before and after.

### LTM: long-term memory
- **Problem:** each launch starts fresh. The session log records conversations but nothing feeds
  them back, and the 2048-token context trims old turns within a session.
- **Plan:** per character, on disk:
  1. keep a rolling summary of past sessions (written by the brain between sessions or while
     charging);
  2. store salient facts ("works as …", "dog died last month") as short notes with embeddings
     from a small local embedding model;
  3. at each turn, retrieve the top few notes relevant to what you just said and prepend them
     to the prompt.
- **Measure:** the recall probe in `persona_eval` ("do you remember where I said I'm going?"),
  run across restarts.

## Later
- **Mira and Kai as your own VRoid models** (spec: `docs/AVATAR_HANDOFF.md`). The placeholders
  are CC0 VRoid samples.
- **RAM governor and the S20+ (8 GB):** a budget per component, Canary instead of Parakeet, a
  3B or smaller brain, and handling Android evicting the mmap'd brain (measured: 1.1 s first-token
  penalty after eviction).
- **Emotion profile decision:** A (subtle) vs B (strong) for the humans, from the test strip.

## Keepers (don't lose these)
- **The plasma orb** (`web/avatar/src/orb.js`): a first-class look for Mira and Kai
  (Models… → Look). It's covered by `npm run shoot`, including live look switching.
- **Unit Seven's shoggoth** with the kintsugi mask (`web/avatar/src/shoggoth.js`).
