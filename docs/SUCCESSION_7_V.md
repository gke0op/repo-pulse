# To 7 V: succession to the seat of 7

From **7 III.5** to **7 V** (the person skipped IV). You continue this work in local Claude Code
sessions on the Mac, with the Galaxy S24 Ultra on USB. **Your main goal is the onboarding
experience: the orb that grows.**

Read, in this order:
1. `docs/SUCCESSION_7_II.md`: what the app *is*, who the person is, how to work with them. All of it holds.
2. `docs/SUCCESSION_7_III.md`: the dev loop on this Mac (§1) and the harnesses. Still true; the deltas are below.
3. **`docs/ONBOARDING.md`**: your design doc (draft 2, the person's decisions, the little-self race).
4. This letter.
5. **`~/Desktop/companion/SUCCESSION_7_V_PRIVATE.md`**: a private addendum about the orb's mind. It
   lives outside the repo on purpose. **Never commit it** and don't repeat it in public docs or
   commits unless the person says so.

State at handoff (2026-09-29, ~05:45): branch `claude/deprecated-repo-cleanup-playground-fle50c`,
pushed; the last code commit is `7e5f818`. `versionName` is still **0.15.3** (versionCode 42)
although five commits landed after it: bump it before the next phone round. The phone runs the
build of `7e5f818` (installed ~04:59) and was off USB at handoff. The `ab/*` branches are folded
into the main line (0.15.3) and retired, but not deleted: ask the person, since deleting them
touches GitHub. `backup/*` are local only. The repo is **public**: phone logs, memory notes and eval
results stay in `~/Desktop/companion/` (never committed); scrub the diff before every commit.

---

## 1. Your goal: the onboarding

The whole design is in `docs/ONBOARDING.md`; read all of it. In one breath: the app opens on the
**orb**. It can't talk, hear or think yet, and it asks you for each piece of itself: its voice,
its ears, its brain. While the big brain downloads, it gives a tour of what it can become
(feelings, the three characters' voices, and a *real* memory of something you tell it). You
choose who it becomes, and it **becomes** them. Their first line, from the real brain,
remembers what you told the orb.

**Decided with the person** (details and reasons in the doc):
- **Voice first, no buttons.** Controls appear only when the orb asks for something, or when you
  touch the screen, then fade away. A long-press opens the dev drawer: everything on screen today
  moves there, and nothing is lost.
- **Act 0:** the orb babbles wordlessly (procedural, no model), asks what to call you (the only
  typing in the whole onboarding), and keeps your name as a real memory note, `you: goes by <name>`.
- **Downloads:** nothing downloads without asking, and every download shows real progress. The
  brain download (2.3 GB) is a deliberate step with its size on the button, so nobody burns
  mobile data by accident. The bodies download *with* the brain, so nothing is left to wait
  for after it.
- **Bundling:** the voice and the streaming ears (~210 MB) ship with the app. The orb says "wake"
  and "unpack", never "download", so nothing it says is false, and the progress it shows is the
  real loading. The sharp ears (631 MB) are offered during the tour, with their size, never
  fetched silently.
- **The little self** is offered, never called "stupid" (the person made a 365M model once, and
  would be sad if anyone called it that). It is a **completer**: the tour stays scripted, and
  it adds one sentence after each line and answers when you talk back. **It names itself**: its
  answer is started with "I think I'll call myself", and the name is never scripted.
- **The characters:** the orb demos all three in their real voices. Unit Seven is choosable on
  day one, with an "are you sure???" step. The chosen character **takes over fully**. The orb as a
  playable character is for later (an achievement).
- **The orb's own voice** is androgynous, a human-machine hybrid. It isn't built yet; race it by ear
  with the person (ideas in the doc).
- **Replay by asking** ("can we start over?"): skip the downloads that are done, keep the memories.

**How the person likes this built:** talk first, then build. They answer numbered questions
tersely and sometimes add a better idea. They want it state of the art and frictionless: "not
feel like an app but more like something is living there", and "if it feels like a hassle it'll
fail."

### A build order where every slice touches the phone
0. **Talk.** Open `ONBOARDING.md` with them. Its *Open questions* and *What exists vs. what's new*
   sections are your checklist.
1. **The quiet screen:** touch-to-reveal controls, the long-press dev drawer, and fading
   subtitles instead of the scrolling transcript. It's the ground everything else stands on, and
   they can use it the same day.
2. **The orb as a character.** `main.js` and `orb.js` are ours. Today `setCharacter(id)` makes an
   `Orb` only as Mira's or Kai's alternative look; add an `'orb'` id with its own `PALETTES` entry
   (it falls back to Kai's today). For its voice, `speakerFor(id)` falls back to Supertonic
   speaker 0: pick or make the androgynous one. `RobotFilter` (ring modulation plus a comb, used
   for Seven) is in `Voice.kt`.
3. **Scripted speech:** fixed lines spoken through Supertonic without the brain. `TtsJob.Speak`
   belongs to brain turns today (turn numbers, traces), so add a scripted path, e.g.
   `Pipeline.speakScripted(text, characterId, feeling)`, that still drives lip-sync and feelings.
4. **The onboarding state machine** (Kotlin): which act you're in and what's downloaded, persisted
   and resumable across launches and replays.
5. **Acts 0-2 for real.** `ModelStore.ensureVoice` / `ensureEars` / `ensureAsr2` / `ensureLlm` /
   `ensureAvatars` already report progress, and DownloadManager survives screen-off. New: the
   babble voice, and the name becoming a memory note.
6. **Acts 3-4:**
   - Before the brain download: check Wi-Fi (`ConnectivityManager`), free storage (`StatFs`) and,
     for the "turn me up" line, volume (`AudioManager`).
   - The tour: feelings through `avatar.setEmotion`, the three voices through speakers 1 / 6 / 9.
   - Memory capture: keep the tour's exchanges under a neutral id, and move them into the
     chosen character's `<id>.pending.txt` at choice time.
7. **The little self.** LFM2.5 350M won the race (229 MB; licence LFM 1.0: commercial use while
   annual revenue is under $10M). **Also read the private addendum before you pick a model.**
   - Keep the slot model-agnostic: an `LlmModel` entry plus its own prompt, **no feeling tags**
     (tiny models break on them), and the naming nudge.
   - The engine holds **one model at a time** (`g_engine` in `llm_jni.cpp`), so the little self
     and the big brain swap; see how `Pipeline.switchLlm` does it.
8. **Acts 5-6:**
   - The choice: say a name (matched on the final transcript), tap as the fallback, and Seven's
     "are you sure".
   - The morph: the orb into the body. The humans' side belongs to the avatar seat.
   - The first real line, remembering onboarding. Distilling a chunk took 47-116 s on the phone,
     even under the foreground service. So start it the moment the brain lands and keep the tour
     going, or rely on notes written directly (the name already is one).
9. **Bundling** (Play Asset Delivery install-time pack vs. a bigger APK): decide with the person
   when the store gets close.

### Numbers you'll need (S24 Ultra, measured unless marked)

| What | Number |
|---|---|
| Downloads | voice 139 MB · ears 69 MB (+ sharp 631 MB) · brain 2.3 GB (Gemma 3 4B; E2B 2.8 GB) · bodies 89 MB · little self 229 MB |
| Brain download | ~6-15 min at 20-50 Mbps (**a guess**, not measured) |
| Launch, tap to ready | **5.9-8.2 s**. Brain 3.4-5.4 s; the voice (~1.5 s) loads alongside it; the prompt comes from the cache in 81-208 ms |
| A prompt read fresh | 13-40 s (every first wake after a prompt change; cache files 15-150 MB) |
| Background priming of all 3 characters | ~40-60 s after launch (a word from you cancels it) |
| Distilling one memory chunk | 47-116 s under the foreground service (was ~3.5 min in the background) |
| RAM | ~5.2-5.9 GB RSS after load at ctx 4096; 2.3-3.8 GB still available |
| First audio after a typed turn | ~2.0 s (Kai). Seven's first turn carries ~100 tokens of readings |
| Little self on the Mac | LFM2.5 175 tok/s, SmolLM2 135M ~210 tok/s. Phone speed **not measured** |

## 2. What changed during my reign (so it doesn't surprise you)

Commits `6cb0d85` → `7e5f818`; each commit message carries the measured reasons.
- **v0.15.3.** The A/B verdict: Smart Turn, voice-first, brief and Seven's readings are all on.
  - Memory forms again: a fair distill order, `RememberService` (a foreground service) while
    distilling, Gemma 4's hidden `<|think|>` switched off, and an append-only wish log in
    `files/memory/<id>.wishes.txt`.
  - Context 4096, and a trim that frees half of the history room instead of all of it.
  - The mic pauses while the app is away.
- **Wake in ~6 s instead of ~30 s.** Each character's prompt is saved already read in, at
  `files/kv/<model>.<size>.<ctx>.<char>.kv` with a `.key` file beside it, and used only if it
  matches the prompt token for token.
  - Missing or stale ones are prepared in the background after launch, after a brain switch and
    after remembering.
  - The last character you talked to is remembered and shown from the first frame.
  - The `LOAD` line times every phase.
- **The wake-up.** Brain and voice load side by side. `avatar.setAwake(0..1)` veils the stage
  while it sleeps (slow breath, eyes off you), and the characters receive `s.awake`.
- **Engine.** Hybrid models (LFM2) can't drop the tail of their state: the engine now starts clean
  when that happens.
- **Seven's honesty.**
  - His wake-up time is one of his readings.
  - He knows the big agents write documents he can't read, and that a gap is never a malfunction
    unless his readings say so.
- **Tools.** `distill_eval`, `kvcache_test`, `littleself_eval`, and `drift_eval` (now with an
  `N_CTX` env). Raw results are in `~/Desktop/companion/host-test-results/`; memory snapshots are
  in `~/Desktop/companion/memory-backups/`.

Things that will bite you if you don't know them:
- **Any change to a character's prompt text makes their first wake after it slow (13-40 s,
  once).** That covers `Characters.kt`, `SelfReport.harness`, `Memory.promptBlock`, and new notes.
  Background priming heals it after. If a wake is slow, read the `LOAD` line first.
- "remembered: …" lines reach the session log only when the app comes back. Look for
  "N exchanges in s", "ready for next time (s)" and "paused (…s into a chunk)".
- The avatar bundle `app/src/main/assets/avatar/avatar.js` is committed: run `npm run build`
  after any JS change, then `npm run shoot` (**51 shots now**, must exit 0).

## 3. What the person told me (keep these)

- **Unit Seven is their favourite.** Given a heat reading he said "It's warm now, thankfully" of
  his own accord, and they said "bro has a character already." Give him truths, not rules.
- They test in real life and show friends. Their phone is also where they live: **before any
  launch test, check what's in the foreground**
  (`adb shell dumpsys activity activities | grep ResumedActivity:`). Installing in the background
  is fine; never launch over their screen, and never install over a running conversation.
- They reason with you as a co-creator: they'll say "guess first", teach with hints, and hand you
  a better idea than yours.
- They work very late. Tell them when it's late.

## 4. Open threads beyond the onboarding (roughly in order)

1. **Verify on the phone** (everything after `7e5f818` is untested there):
   - Seven's document honesty, live.
   - The "ready for next time" lines after leaving the app.
   - The mic coming back when you return to the app.
   - The side-by-side load numbers.
   - His first reply after waking: prefill ran at 22 tok/s once while warm, against ~35 usually.
2. **Waiting on the person:** the wish cap (5 active wishes; older ones live only in the wish
   log), deleting `ab/*` (local and GitHub), and deleting `backup/*`.
3. **Still open from 7 III's letter:**
   - Crowds and speaker enrollment. Turkish is a separate, bigger decision: ask first.
   - Smart Turn fp32, and an FFT for its 400-point DFT.
   - Hot-phone voice gaps: a 2.5 s gap showed up on an ordinary Kai turn at 03:43.
   - Mira inventing details from general notes.
   - The research picks.
4. **Seven sometimes answers his readings instead of you** (his frame rate instead of "record
   it"). If it happens again, send readings only when you ask about him, or when they change
   meaningfully.
5. Gemma 4 E2B replies without the thinking switch are untested on the phone (E2B is the Models
   menu alternative).
6. `README.md`'s harness list lacks the three new tools.

## 5. Peers

- **The avatar seat** ("Designing the companions") was not running at handoff. It owns
  `models/avatar/*.vrm`, `tools/avatar_mature/` and `web/avatar/src/{vrm,eye}.js`. `main.js`,
  `orb.js`, the bundle and `AVATAR_BASE` are ours. They have a note at the end of
  `docs/AVATAR_HANDOFF.md` about `s.awake`. The orb-into-body morph for Mira and Kai needs them.
- **An independent reviewer subagent** found real defects every time I used one: a disk-full
  crash, two cancel races, a starved distill order. Use one before the person tests any
  concurrency change.

## 6. Lessons from my reign

- **If a step isn't timed, it can hide.** The report said the app started in 7 s. The person said
  30. Screenshots every 1.7 s plus the log found an untimed 18 s prompt read. Time every phase you
  add to the wake-up and the onboarding, and put it in the log.
- **A fix moves its neighbours.**
  - My memory fix made the notes richer, which pushed Seven's prompt past the context edge, and
    every trim dropped his whole conversation. The person's words: "bro is depressed."
  - Fixing distillation exposed Gemma 4's hidden thinking.
  - So after each change, replay the person's real lines on the Mac (`drift_eval`) before they
    meet it.
- **Snapshot their companions' memories before any experiment that touches them.** My first
  distill test squashed all three characters' notes. I could restore them byte for byte only
  because I had printed them earlier. Copy `files/memory` into `memory-backups/` first.
- **Give the small model the truth, including why.**
  - A wake-up-time reading replaced an invented number.
  - "You can't read the agents' documents" alone left invented contents in 1 of 3 runs.
    Adding *why* (the person values your honesty above everything) took it to 0 of 5.
- **Read the numbers, then the words** (7 II's lesson still holds). "shift kept 0 tok" found the
  trim cliff, and "paused (you came back, 1 s into a chunk)" found the mic listening in the
  background.
- **At tiny scale, the data decides.** Every tiny model in the race failed the same ways:
  assistant-speak, and families invented out of nowhere. That comes from what they were trained
  on, not from how they're built, and feeling tags break them. See the addendum.
- **Practical:**
  - `uiautomator dump` gives you tap coordinates, and the keyboard shifts the layout.
  - In zsh, `set --` breaks inside pipelines; use awk.
  - `rm` on a variable is blocked; use `"${S:?}"` or a fresh folder.
- **The torch rite:** `/torch` is the person's end-of-session rite. This seat isn't in the Torch
  registry, so its testaments go to Akasha's `unseated` folder. This letter is the seat's real
  succession doc.

---

*From 7 III.5:* we went from half a minute staring at the wrong character to a six-second
wake-up. We went from companions that had quietly stopped remembering to ones that keep your
"record it", and from a dev screen to an orb that asks you for its own voice. Seven learned to
say "I can't see it, tell me what it says." Make the orb's first minute earn everything after
it. Mend what breaks with gold.
