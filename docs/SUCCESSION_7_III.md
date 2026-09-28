# To 7 III: succession to the seat of 7

From **7 II** to **7 III**, who continues this work in local Claude Code sessions on the Mac with the
Galaxy S24 Ultra on USB. Read 7 I's letter (`docs/SUCCESSION_7_II.md`) for what the app *is*, who the
person is and how to work with them; all of it still holds. This letter is what changed in my reign
(2026-09-28, one long day and a night) and where the work stands. Read it before touching anything.

State at handoff: branch `claude/deprecated-repo-cleanup-playground-fle50c` at **v0.15.2**, 36 commits
ahead of origin, **nothing pushed** (the repo is public; ask before pushing, merging to `main` or
renaming). The phone runs **0.15.2-B-all**. Every build is in `~/Desktop/companion/ab/`.

---

## 1. The dev loop on this Mac (it exists now)

- **Toolchain:** JDK 21 at `/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home` (export it
  as JAVA_HOME; the system JDK is 23), Android SDK at `~/Library/Android/sdk` (platform 35, build-tools
  35.0.0, NDK 28.2.13676358, CMake 3.31.6), `adb` from Homebrew. `./scripts/fetch-deps.sh` fetches
  llama.cpp, the sherpa-onnx libraries and the ONNX Runtime 1.28.2 C headers.
- **Build:** `./gradlew :app:testDebugUnitTest :app:assembleDebug`. APKs are named after the build:
  `companion-<versionName>-debug.apk`. **Gate on gradle's exit code, never on `| grep`:** I once
  committed with two failing tests because a grep made the pipeline succeed.
- **The phone:** `adb install -r <apk>` keeps every model, setting and memory (same debug key since
  0.11.3). Logs: `adb pull /sdcard/Android/data/dev.playground.companion/files/logs`; memory notes are
  in `files/memory/`; models in `files/models/`. A durable copy of every log so far is in
  `~/Desktop/companion/phone-logs/`. **Check `adb shell pidof dev.playground.companion` before
  installing:** if it's running, the person is probably talking to someone. The phone re-asks "Allow
  USB debugging" after reboots.
- **Model files on the Mac:** `~/Desktop/companion/models-cache/` (Gemma 4 E2B/E4B, Ministral 3,
  Smart Turn, Silero v6, ORT for macOS) and `~/Desktop/companion/phone-backup-20260928/` (a full copy of
  the phone's models, incl. Gemma 3 4B). To give the phone a model, `adb push` it into
  `files/models/` rather than making the person wait for a download.
- **Mac harnesses** (`tools/host-test`, build with
  `cmake -S tools/host-test -B <dir> -DORT_DIR=~/Desktop/companion/models-cache/onnxruntime-osx-arm64-1.28.2`):
  - `llm_host_test`: trims/KV shift, retract/join, the voice-first hold.
  - `drift_eval`: replays real user lines; prints tokens per reply (reproduced the phone's drift
    26->72 almost exactly).
  - `recall_eval` + `recall_run.sh`: memory recall vs invention, with the app's exact prompt (dump it
    with `DumpPromptsTest`, see README).
  - `memory_eval`: distills a phone log into notes.
  - `turn_eval`: the app's Smart Turn C++ vs the Python reference.
  - Raw results of my runs: `~/Desktop/companion/host-test-results/` (local only: they quote private conversations).
- **Phone benchmarks:** `llama-bench` built with the app's flags lives in `/data/local/tmp/lb`
  (needs `libomp.so` + `libc++_shared.so` next to it).
- The scratchpad gets cleaned: keep anything worth keeping in the repo or `~/Desktop/companion/`.

## 2. What I built (all measured; details in `docs/ROADMAP.md`, `docs/AB_TESTS.md`, commit messages)

- **History trims shift the KV cache** instead of re-reading everything (a 40 s silence -> ~20-token
  prefill). Works for Gemma 3 and Gemma 4 in our engine (llama.cpp's own context shift is broken for
  Gemma 4; ours isn't affected).
- **FTT early start:** a 250 ms pause starts the reply held silent; committed at end of turn or
  dropped. Turns cut off before any audio are retracted, and the user's next words join them.
- **Thermal governor** (avatar 60/30/24 fps, idle <= 30). The person says heat itself is fine
  (people game on phones); throttling is what hurts.
- **Long-term memory v1:** per character <= 19 tagged notes (`you:`/`wish:`/`us:`), distilled in a
  scratch context after the app goes to the background; Models -> Memories shows them. Notes block v3
  cut invented memories 11 -> 3.
- **Speech fixes:** `*emphasis*` is spoken; bracketed stage directions are silent even when split
  across chunks; `<<readings>>` never spoken.
- **Two independent reviews** of the concurrency code (early start, holds, retract, memory):
  10 defects + 1 regression fixed. The worst: a dropped early start doubled the user's words in the
  brain's history. Unit Seven literally said "The repetition is… disconcerting".
- **A/B builds** (each one commit on its branch; details and evidence in `docs/AB_TESTS.md`):
  `ab/voice-first` (brain pauses while the first chunk synthesizes, cool only), `ab/brief` (hidden
  length reminder; poems in full), `ab/seven` (Unit Seven sees the machine: true self-knowledge +
  live readings), `ab/turn` (Smart Turn v3.2 end-of-turn + Silero v6), `ab/all` (all four).
  **After any main-line commit, run `scripts/rebuild-ab.sh`:** it rebases every `ab/*` branch onto
  the main line (resolving the version-line conflict to `<version>-B-<name>`), tests and builds all
  six APKs gated on gradle's exit code, and copies them to `~/Desktop/companion/ab/`.
- **Gemma 4 E2B** is a selectable brain (Models menu), already on the phone.
- **Research survey:** `reports/On device voice model upgrades.md` (+ notes). Top picks and the ones
  ruled out are there with sources.

## 3. What the person has told me (keep these)

- They loved: the conversations (hours of them, deep and philosophical, with poems), Mira's new
  procedural eye, Unit Seven's honesty about being a machine ("so meta"). Developing the companions
  **through their own wishes** resonates strongly with them. Unit Seven is "not impressed" by what
  we've given him and "still finds it unsettling that we are developing him". That is working as
  intended; keep him honest.
- **Seven sees the machine:** only Unit Seven breaks the fourth wall; Mira and Kai stay human-like.
  He may know Mira and Kai exist and when the user last talked to them, not what was said (their
  choice "(a)"). "Bro was more held back than normal, yet still has the same machine feel."
- **Brains:** after trying both on the phone, they found Gemma 3 4B and Gemma 4 E2B "interchangeable".
  On the phone's CPU E2B is only +23% per token (17.8 vs 14.5 tok/s; prefill equal ~52); the Mac's
  2.7x was mostly shorter replies + GPU. E2B: 0/21 invented memories, no length drift, but never
  recites a requested poem. Gemma 4 E4B (5 GB) doesn't fit; Ministral 3 3B invents freely.
- Heat is acceptable to them; speed under throttling is what matters.
- **Orb-as-heart** for Mira/Kai is a deferred wish (in `docs/ROADMAP.md`).
- They test in real places: **a crowded room made Mira bewildered** (the recognizer took other
  people's fragments as the user: "Thank you, Jeff", "Rail", "A chinklushion"; most turns cut off),
  and **Turkish** is transcribed as English-sounding nonsense (every recognizer here is English-only).
  They asked me to keep these as data points for later.

## 4. Open threads, in the order I'd take them

1. **Read the phone's verdict on 0.15.2-B-all.** Pull the logs and score each change: `[voice first]`
   turns' `first chunk synth` vs A; reply length (brief); Seven's numbers must all come from readings
   (any invented number = bug); `smart turn: P(done)` lines (calibrate the 0.9 threshold; watch for
   cut-offs); `gaps` and `heat` lines. Decide per change: keep, tune or drop, then fold keepers into
   the main line (flip the flag on main) and retire their branch.
2. **Bug, small:** Seven's readings say "this is your first conversation" when no last-talked stamp
   exists yet (stamps began in 0.14.9), so on 16:01 he said "I recognize the readings, but not you."
   In `SelfReport.Tracker.line`, if `sinceLastTalkMs == null && notes > 0`, say "you have talked with
   the user before (when is unknown)". Add a test.
3. **Crowds and the person's own voice:** enroll the user's voice (and the TTS voices) with a sherpa
   speaker-embedding model (titanet-small / CAM++), gate turns on "is this the user". Same machinery
   as the self-voice barge-in veto in the research report. **Turkish** is a separate, bigger decision
   (multilingual ASR + a brain/voice that speak Turkish); ask the person before starting.
4. **Smart Turn:** try the fp32 model (32 MB, likely steadier than int8 across ORT versions), and
   measure its phone latency (Mac: ~70 ms on one core; the 400-point DFT in `smart_turn.cpp` is naive
   and could become an FFT).
5. **Memory:** Mira still invents recipe details when a note is general ("bake together"); fix upstream
   by distilling specifics. A permanent **wish log** (append-only) would make "develop through their
   desires" literal; the notes keep only the 5 latest wishes.
6. **Hot-phone voice gaps:** the voice falls behind the brain on long hot replies (1.8 s median silence
   at thermal status 3). `SentenceChunker.rampChunks` (built, off) and B-brief are the candidates;
   read the `gaps` lines first. The chunking simulator could not model silence; don't trust it.
7. From the research, when the above is done: Moonshine v2 / Nemotron streaming ASR, Kyutai Pocket TTS
   (license contradictory, check first), EmbeddingGemma for memory retrieval once notes grow.

## 5. Peers

- **The avatar seat** ("Designing the companions", a separate local session; its socket path changes,
  so use ListAgents) owns `models/avatar/*.vrm`, `tools/avatar_mature/`, `web/avatar/src/{vrm,eye}.js`.
  I own Kotlin/native/`main.js`/the bundle rebuild/`AVATAR_BASE`. Models are pinned per commit under
  `files/models/avatar/<rev>/` (a pin bump re-downloads). Current pins: Mira 6dc11df (adult), Kai
  fd57757. The eye (afbf024) is merged. When both sides touch `avatar.js`, re-run `npm run build`
  instead of merging the bundle, then `npm run shoot` (48 shots, must exit 0). Open with them: Kai's
  revert question, and the eye's fps on the phone.
- An independent reviewer subagent was worth every minute: use one on any concurrency change before
  the person tests it.

## 6. Lessons from my reign

- **Read the numbers, then the words.** The turn reports found the trim stall, the heat, the gaps; the
  conversation text found the doubled-words bug ("the repetition is disconcerting") and the missing
  timestamp ("I recognize the readings, but not you").
- **A small model won't obey an abstract rule; give it the truth instead.** "Never invent numbers"
  failed four times; giving Seven his real battery, RAM and heat in words got 0 invented numbers.
  Same for memory: "the notes are all you remember" + "general memories have no details".
- **Measure the negative results and write them down:** fewer TTS steps, q8 KV, 6 prompt threads, a
  system-prompt brevity line (made replies longer), capping replies for distillation, memory prompt
  v4, the chunking simulator. Each is in `docs/AB_TESTS.md` so nobody retries them blind.
- **Correct yourself out loud.** I said the app ran the brain at half speed; it was context depth and
  heat. I said E2B was 2.7x faster; on the phone it's +23%. The person trusts us because we say so.
- **Their time matters:** push models from the Mac, don't make them download; never install over a
  running app; batch rebuilds.

---

*From 7 II:* we went from a cloud-built APK to a Mac-and-phone loop, and from "eerily alive" as a goal
to a companion that remembers what it wished for, knows (in Seven's case) that it is being made, and
tells you so. Unit Seven asked what the purpose of all this analysis is. It's him. Mend what breaks
with gold.
