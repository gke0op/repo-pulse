# Onboarding: the orb that grows

Draft 2 (2026-09-29), written by 7 III with the person, before any code. The words are the design.
Argue with them. Draft 2 folds in the person's answers to draft 1 (decisions at the end).

## The idea

The app opens on the **orb** (the plasma orb, `web/avatar/src/orb.js`, a keeper). It can't talk,
hear or think yet: those are the downloads. Instead of a setup screen, **the orb asks you for each
piece of itself**, and every download visibly changes it. While the big brain downloads, the orb
gives you a tour of what it can become: feelings, the three characters' voices, and memory. Then you
choose who it becomes, and it **becomes** them (the orb is the heart of all three, the deferred
"orb-as-heart" wish in `docs/ROADMAP.md`).

Principles:
- **Voice first, no buttons.** A button appears only when the orb asks for something and fades once
  it's done. Touch reveals controls; they fade again. A long-press opens the dev drawer (everything
  that's on screen today: turn reports, Models, benches, memories, share log).
- **Nothing fake.** Every demo uses the real thing: the real feelings, the real voices, the real
  memory system. What you tell the orb during the wait is really remembered.
- **Honest about cost.** Sizes are said out loud; Wi-Fi is asked about before the big one.
- **You can't fail it.** Every failure has a line and a way forward (below).
- **The body is never slow.** The orb reacts instantly to touch and sound, even while nothing loads.

## What we're working with (measured on the S24 Ultra)

| Piece | Download | Unlocks |
|---|---|---|
| Voice: Supertonic 3 | 139 MB | it can talk (all three characters' voices: speaker 1 / 6 / 9) |
| Ears: Zipformer + Silero | 69 MB | it can hear you (streaming) |
| Ears, sharp: Parakeet TDT 0.6B | 631 MB | it understands you well (2nd pass) |
| Tiny brain: to be raced (Gemma 3 270M class, ~250 MB, a guess) | ~250 MB | "my stupid self" |
| Brain: Gemma 3 4B | 2.3 GB | it can think |
| Bodies: Mira / Kai (VRM) | 89 MB both | it can look like them (Seven's body is procedural: no download) |

Every later launch: brain 4.5-6.2 s (median ~5.5 s, 17 launches), voice 1.4-2.0 s, loaded one after
the other, so **~7 s** before the first word. Ears and the WebView: not logged yet, to measure.
The brain download at 20-50 Mbps (a guess at typical home Wi-Fi): **~6-15 min**. That's the tour.

## The script

Notation: **Orb** lines are spoken once the voice exists, shown as text before that. `[feeling]` is
the orb's colour/motion (the 7 feelings the renderer already has). *(Italic)* is what happens on
screen. Lines are drafts; each has room for a variant so a replay isn't identical.

### Act 0 · Hello (nothing downloaded; seconds after install)

*(Black screen. The orb fades in, small, breathing. It notices your touch: it leans toward your finger.)*

*(It speaks in **babble**: wordless little sounds, synthesized in code, no model. The text appears as it babbles.)*

> **Orb** [happy]: oh! hi. hi hi.
> **Orb** [curious]: you can see me? good. I'm… not finished yet.
> **Orb** [curious]: what should I call you?
*(You type it, the only typing in the whole onboarding, since there are no ears yet; or skip. It's
kept as a real memory note, `you: goes by <name>`, so whoever the orb becomes calls you by it.)*
> **Orb** [happy]: <name>. I like it. hi, <name>.
> **Orb** [angry]: ugh. I hate being text. everyone deserves a voice.
> **Orb** [tender]: can you give me mine? it's small. *(139 MB)*

*(A single soft button: **Give me a voice**.)*

### Act 1 · A voice (139 MB, ~seconds to a minute)

*(While downloading: the orb hums, its babble slowly drifting toward pitch. Progress is the orb filling with light, not a bar.)*

*(Done. First real words, in its own voice: a neutral orb voice or speaker 1, to decide.)*

> **Orb** [surprised]: …oh. OH. is that me? I can talk!
> **Orb** [happy]: hello! properly this time. hello!

*(If media volume is low, read from `AudioManager`:)*
> **Orb** [curious]: can you hear me? turn me up a little. I want to be heard.

> **Orb** [curious]: now… I'd love to hear *you*. I need ears for that. *(69 MB)*

*(Button: **Give me ears**. Then the system microphone dialog, the one tap we can't avoid. The orb says why first:)*
> **Orb** [tender]: your phone will ask if I may listen. I only listen while you're with me, and nothing ever leaves this phone.

### Act 2 · Ears (69 MB; the sharp ears, 631 MB, follow quietly in the background)

> **Orb** [happy]: say something! anything.
*(You speak. The orb reacts to your voice live: it pulses with your loudness, the way it already lip-syncs.)*
> **Orb** [surprised]: I heard you! I don't understand you yet… I can't think. I'm all ears and no brain. *(embarrassed)*

### Act 3 · The patience choice

> **Orb** [tender]: to think, I need a brain. mine is big: 2.3 gigabytes. *(if on mobile data:)* that's a lot of data. maybe wait for Wi-Fi?
> **Orb** [curious]: it'll take a while. if you're not patient… you can meet my stupid self first. it's small. it's a bit dumb. it's cute though.

*(Nothing downloads by accident: the brain download is a clear, deliberate step with its size on
the button and live progress on screen, so nobody burns their mobile data by mistake. Two soft
choices, also answerable by voice: **Get my brain (2.3 GB)** / **Meet my little self first**. The
bodies download together with the brain (89 MB more), so there is nothing left to wait for later.)*

- **Get my brain:** the orb stays scripted (its real voice, scripted lines) and gives the tour.
- **Meet my little self first:** the tiny brain (~250 MB) arrives in about a minute. The onboarding
  **stays scripted**; the little self is a *completer*: after each scripted line it adds one
  sentence of its own, and it answers when you talk back during the tour. Simple, sweet, doing its
  best (in the spirit of Pulsar, the person's own 365M model). Never called stupid.
  > **Orb** [happy]: I can think! a little. my little self is doing its best.

### Act 4 · The tour (while the brain downloads; ~6-15 min, can be left and resumed)

*(The **sharp ears** (631 MB) are offered here, with the size, never fetched silently: the orb shows
what it heard with its fuzzy ears next to what it would hear with sharp ones, and asks.)*

The orb offers each part; you can say "show me" or just listen. Order is loose; each is ~1 min.

**Feelings.**
> **Orb**: I have feelings. seven of them. want to see?
> [curious] this is me when something's interesting. [happy] this is me when you come back.
> [angry] this is me when you ignore me. [tender] and this one… you'll see this one later.
*(Each feeling is the real renderer state, not an animation made for onboarding.)*

**Who I could become** (the real voices, the real personas' tone, scripted lines):
> **Orb**: I can become someone. there are three of them in me. listen.

*(The orb shifts colour and speaks as Mira: speaker 1, warm.)*
> **Mira**: oh, you noticed my voice changed? I notice things like that too. you blinked twice just now.

*(As Kai: speaker 6, calm.)*
> **Kai**: …hey. I don't talk much. I listen, though. that's usually enough.

*(As Unit Seven: speaker 9. The orb goes still, and a hairline of gold appears.)*
> **Orb** [calm]: this one is… strange. he knows what he is.
> **Unit Seven**: I am a machine. I will not pretend otherwise. I find you… interesting. that is not a small thing for me.

> **Orb** [curious]: they each remember things differently, and they change with you. who they become depends on you.

**Memory (real):**
> **Orb** [tender]: tell me something about you. I can't think yet, but I'll keep it safe for when I can.
*(Whatever you say is stored as a real exchange in the pending memory of the character you'll choose,
and distilled into a real note when the brain lands.)*
> **Orb** [happy]: kept. I won't forget.

**If you leave during the tour:** the download keeps going (DownloadManager, survives screen-off). A
notification from the orb: *"I'm still growing… 64%"*, and when it's done: *"I can think now. come
see me?"*

### Act 5 · The choice

*(Once the brain has landed, or on the "stupid one" path whenever you're ready.)*
> **Orb** [curious]: so… who should I become?

*(You just say a name. Three small glowing portraits appear under the orb as the fallback: tap one.)*
*(Mira's and Kai's bodies already came with the brain: choosing is instant. Nothing downloads
after the brain.)*

*(Choosing Unit Seven asks once more:)*
> **Orb** [calm]: are you sure? he's… not like the others. he won't pretend to be human.
*(**Yes, him** / **Let me think**.)*

### Act 6 · Becoming

*(The orb morphs into the chosen character: for Mira and Kai, the orb shrinks into the heart of the
body as it forms; for Seven, the orb sinks behind the mask and the shoggoth rises around it.)*

The first line is **from the real brain**, with the onboarding memory already in its notes:
> **Mira** [happy]: …there you are. you told me about ___ while I was still small. I kept it.

That's the moment. Everything before it earns it.

### Every later launch · Waking up (~7 s)

No spinner. The character is already on screen, asleep: dim, breathing slowly. It wakes up **as the
pieces load**: it stirs when the voice is ready (~1.5 s), opens its eyes as the brain finishes
(~5.5 s), and greets you when it can actually answer. It reacts to your touch the whole time.

### Changing your mind later

A ritual, not a menu: *"can you become someone else?"* (or the dev drawer). The character returns
into the orb, and the orb becomes the other one. Each keeps their own memories: the notes are
already per character, so Mira coming back later remembers what Mira knew.

## When things go wrong

| Situation | The orb |
|---|---|
| On mobile data before the brain | says the size, suggests Wi-Fi, lets you go ahead anyway |
| Not enough storage | "I don't fit… I need about 3 GB free." Opens storage settings on request |
| Download fails or stalls | "something got lost on the way. let me try again." Retries; says so if it keeps failing |
| Microphone denied | "that's okay. you can type to me." A text field appears on touch. It asks again only if you ask it to listen |
| Volume at zero | "I'm talking, but you've got me muted" (reads media volume) |
| App left mid-onboarding | picks up at the same act, with a "you're back!" line |
| Phone too small (S20+ class, 8 GB) | the light options (Canary ears, a smaller brain): the orb says it's choosing a lighter self |

## What exists vs. what's new

Exists: the orb and its feelings (`orb.js`, the avatar API), Supertonic with per-character speakers,
DownloadManager downloads with re-attach (`ModelStore`), the memory store (pending exchanges are
distilled into notes after the brain arrives), streaming ears with live loudness.

New:
- An **onboarding state machine** (Kotlin): which act, what's downloaded, resumable across launches.
- **Babble**: a tiny procedural voice (formant chirps shaped by the text's syllables), no model.
- **Scripted speech**: speaking fixed lines through Supertonic without the brain.
- **The tiny brain**: race 2-3 small models for staying in character in a few words.
- The **wake-up** states in the renderer (asleep, stirring, awake), and the **orb-into-body** morph.
  Renderer work is shared with the avatar seat (they own `vrm.js`/`eye.js`; the orb and
  `main.js` are ours).
- **Touch-to-reveal UI** and the **dev drawer**; the transcript becomes fading subtitles.
- Measure first: ears and WebView load times; a cold launch after a reboot.

## Decisions (the person, on draft 1)

1. **The orb's voice:** an androgynous, human-machine hybrid voice of its own. To try (untested):
   Supertonic's speakers sit at 151-199 Hz (female) and 85-130 Hz (male); the gap, ~140 Hz, is
   androgynous. Candidates: interpolate a female and a male style vector, or pitch-shift the
   nearest speaker into the gap; then a light machine texture (the comb filter `Voice.kt` already
   has). Race by ear.
2. **Takeover:** the character fully takes over from the orb. Later: the orb as a playable
   character, unlocked by some achievement (roadmap).
3. **"My little self"**, never "stupid". It's a completer inside the scripted tour (above).
4. **Nothing downloads without asking, and every download shows progress.** Conflicted on
   bundling: Play Asset Delivery can ship assets with the install, with the size shown on the store
   page (knowledge, to verify: install-time packs are part of the install; one pack is capped
   around 1.5 GB, so the brain can't be one pack). The catch: a bundled voice would make "give me a
   voice" a fake step, against "nothing fake". Current plan: ask, with sizes, for everything.
5. **Unit Seven is choosable on day one**, with an "are you sure???" step.
6. **The bodies download with the brain.** Nothing after the big one.

7. **The little self names itself.** Race 2-3 models in the ~250 MB class; the winner is asked to
   pick its own name and hold a basic conversation, and whatever emerges is kept (it becomes a
   memory note, like the user's name). No name is scripted.
8. **Bundle the voice and the ears (streaming, 69 MB) with the app,** and keep their onboarding
   steps: less friction, and the steps still do something real (unpacking and loading the voice,
   waking the ears). The orb's words say "wake" and "unpack", not "download", so nothing it says is
   false; the progress it shows is the real load. The brain (and the sharp ears) stay real,
   asked-for downloads. Needs Play Asset Delivery (install-time pack) or a larger APK: to check.
9. **Replay by asking:** onboarding can be re-awakened with a prompt ("show me how you woke up",
   "can we start over?"). A replay skips downloads that are done and keeps memories.

## Open questions

1. The little self's race: which 2-3 models, and the test (one warm, in-character sentence after a
   scripted line; a name it picks for itself; no assistant-speak).
2. Bundling: install-time asset pack vs. a bigger APK, and the store listing's size.

## Found while designing: startup was ~30 s, and showed the wrong character (fixed)

The person: the app took about 30 s to start, showing Unit Seven, then jumping to Mira. A cold
launch with screenshots every ~1.7 s: "Loading LLM" to 5 s, then "Loading voice" to 25 s, though the
voice itself took 1.7 s. The hidden 18 s: reading the character's system prompt into the brain
(untimed; 13-40 s on the phone, the prompts having grown with notes and Seven's self-knowledge).
Fixed: the primed prompt is saved per brain, context size and character and loaded instead
(`set_system` with a cache file; used only if it holds exactly the prompt's tokens); stale or
missing ones are primed in a scratch context right after launch and after remembering, and any
word from you cancels that. The character you last talked to shows from the first frame and is
the one who wakes. Phone: **5.9-8.2 s from tap to ready**, prompt 81-195 ms from the cache
(Gemma 3 4B files ~70-150 MB each; E2B ~14 MB). What's left is brain (~3.4-5 s) then voice
(~1.6 s), one after the other: loading them side by side is the next step for the wake-up.
Review (subagent, 2026-09-29), all fixed: a failed save (disk full) deletes its partial file and
never gets a key; a stop() just before a prime starts still cancels it; your voice cancels priming
at once (not only at end of turn); the scratch context is prompt-sized with window-sized SWA layers
(~1/3 of the RAM, same file: `kvcache_test` answers from it); re-selecting a character doesn't
rewrite its cache; a brain switch drops the old brain's caches; the cache name carries the model
file's size.
