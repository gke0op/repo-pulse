# Onboarding: the orb that grows

Draft 3 (2026-09-29), designed with the person and playable as a prototype on the Mac
(`web/avatar/proto/`, `npm run proto`). The words live in `web/avatar/proto/src/script.js`. Decisions are
numbered at the end; argue with them.

## The idea

The app opens on the **orb** (`web/avatar/src/orb.js`). Everything but the brain ships inside the app:
its voice, both of its ears and the three bodies. The orb wakes them itself, one by one, with you
playing along. Its voice comes out unsettled, every voice at once, and **you find its voice** by
dragging it up and down. The one real ask is its brain (2.37 GB, its size on the button). While the
brain downloads, it shows you what it can become: its feelings, the three characters in their real
voices, and a real memory of something you tell it. You choose who it becomes, and it **becomes**
them; their first line, from the real brain, remembers what you told the orb.

Principles:
- **Voice first, no buttons.** A button appears only for a real decision (the brain's download, the
  choice). Everything else is a touch, a hold, a drag or a word; controls fade once done.
- **Nothing fake.** Every demo is the real thing (the renderer's feelings, the app's voices, the memory
  system), and every progress bar is real work (in the app: unpacking and loading).
- **Honest about cost.** Sizes are said out loud; Wi-Fi is suggested before the big one.
- **You can't fail it.** Every ask has a hint, then it does it itself; with no internet at all, the
  onboarding still plays to the end, and the brain waits for a connection.
- **The body is never slow.** The orb answers touch and sound at once, even while nothing loads.
- **Lines never repeat; feelings may.** It talks calm, cute and playful, a little embarrassed, and
  never says sorry. `npm run check-script` enforces the words.

## What it's made of (measured on the S24 Ultra)

| Piece | Size | Where | Unlocks |
|---|---|---|---|
| Voice: Supertonic 3 | 139 MB | in the app | talking: the orb's found voice, Mira (speaker 1), Kai (6), Seven (9) |
| Ears: Zipformer (streaming) | 69 MB | in the app | hearing, live |
| Sharp ears: Parakeet TDT 0.6B | 631 MB | in the app | understanding well (the 2nd pass) |
| Bodies: Mira + Kai (VRM) | 89 MB | in the app | their bodies (Seven's is procedural) |
| Turn-taking: Smart Turn + Silero VAD | 11 MB | in the app already | knowing when you've finished |
| Brain: Gemma 3 4B | 2.37 GB | **the one download** | thinking |

About 940 MB in the install. The brain takes ~1 min at 300 Mbps, 3 at 100, 6 at 50, 16 at 20.

## The flow (as the prototype plays it)

Each act in a line or two; the words are in `script.js`.
- **0 · Hello.** Dark; the orb asleep, small and dim, until your touch wakes it (a happy hop). It
  babbles (the words appear as it does) and asks your name: each letter is born from the orb, and
  Enter sends them into it (kept as a memory note, `you: goes by <name>`). "can you tap me? I think
  it might wake my voice."
- **1 · A voice.** Your tap wakes its voice (a hum that grows as it fills with light, then the bell
  motif). Two seconds of silence. Then the voice comes out spliced from four voices, a radio between
  stations: "…oh. oh! is that me?". "help me find mine? drag me up and down, slowly." Up is higher and
  smaller, down deeper and bigger, and it says "is this me?" in the voice under your finger; let go
  and "…that one. that's me!" (kept; with no help for 40 s it keeps the middle voice). Then "…hold me
  for a second?"
- **2 · Ears.** Your hold wakes both ears at once. It explains the microphone before the phone asks
  (it only listens while you're there, nothing leaves the phone), says "say something! anything!",
  listens until you've finished (one retry if it missed you), and laughs: "hahaha. that sounds like a
  human, I guess…".
- **3 · The brain.** Its size, honestly. Offline: it says the brain lives on the internet and goes on.
  On mobile data: it suggests Wi-Fi. The one button: **Get my brain (2.3 GB)**, or later.
- **4 · The tour**, while the brain downloads. The feelings: it names each one calmly, then the
  feeling comes and stays ~4.5 s with its own wordless sound. "tap me three times?" wakes the three
  bodies; Mira and Kai speak in their colours and real voices; "and this one… isn't a feeling. he
  knows what he is." introduces Seven. "tell me something about you?" (typed in the prototype; in
  the app, said), kept for whoever it becomes: in the app it goes into the chosen character's
  pending memory and is distilled into a note when the brain lands.
- **5 · The choice.** Three glowing portraits (hovering tries on their colours); in the app you can
  also just say a name. Seven asks "are you sure? he's… not like the others."
- **6 · Becoming.** If the brain isn't here yet, it waits (progress lines; offline, it asks for its
  brain once you're connected). Then the leitmotif, half; "…oh. oh! I can think now!"; 2.5 s of
  silence; "here I go. don't look!"; the whole leitmotif while it goes dark, the character forms and
  wakes; 3 s of the character looking at you; then their first line, which remembers your name and
  what you told the orb. (The morph is the avatar seat's: for Mira and Kai the orb shrinks into the
  heart of the body as it forms; for Seven it sinks behind the mask as the shoggoth rises.)

**Every later launch (~6-8 s).** No spinner: the character is already there, asleep, dim and breathing
slowly; it stirs as the voice loads, opens its eyes as the brain finishes, and greets you when it can
answer. It reacts to your touch the whole time.

**Changing your mind later.** A ritual, not a menu: "can you become someone else?" The character
returns into the orb, and the orb becomes the other one. Each keeps their own memories.

## When things go wrong

| Situation | The orb |
|---|---|
| No internet at all | plays through; says its brain lives on the internet; asks for it once you're connected |
| On mobile data | says the size, suggests Wi-Fi, lets you go ahead anyway |
| Not enough storage | "I don't fit… I need about 3 GB free." Opens storage settings on request |
| Download fails or stalls | says so ("the internet ran away"), keeps what it has, resumes |
| Microphone denied | "that's alright. you can type to me instead." It asks again only if you ask it to listen |
| It didn't catch you | "hmm, I didn't catch that. once more, a bit louder?", once, then moves on |
| You don't play along | a hint after 6 s; after 25 s it does it itself ("no tap? hmph. I'll wake it myself, then.") |
| Volume at zero | "I'm talking, but you've got me muted" (media volume, from `AudioManager`) |
| App left mid-onboarding | picks up at the same act with a "you're back!" line; the download keeps going |
| Phone too small (8 GB) | the light options (Canary ears, a smaller brain): it says it's choosing a lighter self |

## The orb (the renderer; ships in the app)

`avatar.setCharacter('orb')` is the onboarding's own being (its colours sit between Mira's warmth and
Kai's cool); Mira's and Kai's orb look share its life. It has no face, so it feels through **where it
goes, how big it gets, how fast it moves and what colour it turns**, across the whole 9:16 stage:
calm floats above the middle; a tap is a hello (a hop, a warm flash); three quick taps excite it
(small, fast, bright, bouncing off the edges); a held finger calls it over; happy hops, sad sinks
half out of view, angry swells red and shakes, surprised shrinks then pops, curious leans side to
side with its eyes darting, tender comes close and warm. Its gaze is a soft inner light that looks at
you, glances away and blinks. Moves are damped springs.

Two corrections from the person shaped it: the first take deformed its skin toward your finger ("it
reads like we are bullying the orb"), so it now moves instead; and stretching into ovals "reads as
fickle", so its body is firm and only the outer 2.5% of the radius gives. It renders at the panel's
120 Hz (the thermal governor's cool level is 120 fps; the heavier bodies stay at 60).

For the onboarding it also takes: `setFill` (progress as light filling it), `hear` (your voice's
loudness), `setPalette` (a character's colours), `setTune` (small and high to big and deep, for
finding its voice), `joy`, `where` (its place on screen), and `?frame=1` (the 9:16 frame).
`?char=orb&play=1` is a keyboard playground (feelings 1-7, states, a skin tuner).

## The prototype (`web/avatar/proto/`, Mac only, never shipped)

- **Run:** `cd web/avatar && npm run proto`, then `http://localhost:8766` (a second copy says it's
  already running). **Test:** `npm run walk-proto`, a headless walk through every act (it taps,
  drags, holds and speaks through a fake microphone), online or offline. **Words:** `npm run
  check-script`.
- **The voices** are the app's own: `proto/voice_server.py` runs the same Supertonic 3 files with ONNX
  Runtime, the pipeline sherpa-onnx runs on the phone (duration, text encoder, 5 flow-matching steps,
  vocoder), with the app's speakers, speeds and Seven's robot filter, and blends two speakers'
  style vectors (`mix=a,b,t`) for the found voice. It needs the model in
  `~/Desktop/companion/models-cache/`; without it, the Mac's own speech stands in. Every scripted line
  is made ahead in the background, so a line starts the moment it's due (the app can do the same).
- **The sound** (`proto/src/sound.js`): the babble is one soft voice per line that glides, wavers and
  breathes (the hum by default); every tonal sound is in C major pentatonic; the leitmotif (glass
  bells, C E G C) plays small at each waking, half as it starts to think, whole at the becoming.
- **Simulated, and the side panel says so:** the brain's download and the network. The panel also
  sets the babble style, the speed, where to start, and shows what it knows, its voice, and a live
  mic meter (your level, the room's, what it needs).

Measurements worth keeping for the port:
- **The ten voices**, from highest (YIN over three lines): 3 (220 Hz), 1 (200), 2 (190), 0 (185),
  4 (156), 5 (152), 8 (127), 7 (115), 6 (93), 9 (86). Half blends land between neighbours, within a
  take's own spread (~±10 Hz; each take starts from random noise). 4 and 5 blended (~150 Hz) is the
  most androgynous: the middle voice.
- **The key:** rendered offline, all 44 notes held 90 ms or more are C, D, E, G or A.
- **The babble:** against the first, beep-per-syllable take, the same line is darker (418 to 285 Hz),
  swells three times more gently and has a third of the gaps, at the same loudness.

## Plan: the Kubrick pass

A frame-by-frame look (every line timed with the real voice) found the orb talking 58% of the time
with the same 0.65 s after every line, "…" in 28 of 49 lines, "okay" opening 10 lines, one line said
four times, four wakings of one shape, an 82 s stretch with nothing to do, and a missing third act:
the tour covers 2.7 minutes of a download that can take 3 to 16. The person's rules from it:
feelings may repeat, lines never do; pauses, tones and talk get the same care; the orb's voice is
found, not given.

1. **Words** (done): the script checker, the rewrite, Seven's echo, the narration cut.
2. **The voice is found** (done): the glitch, the drag, the blends, the kept voice.
3. **Silence and music** (done): pauses by meaning (a question 0.9 s, an exclamation 0.5 s, a
   trailing "…" 1 s), three held silences, one key, the leitmotif.
4. **You drive** (next): the feelings advance when you tap (and repeat, without lines); the character
   sleeps until your touch wakes it, as the orb did.
5. **The third act:** a realistic download clock; "you can go do something. I'll call you when I can
   think." (a notification: "I'm still growing… 64%", then "I can think now. come see me?"); if you
   stay, small questions about you, each kept as a memory; milestone lines, never the same twice.
6. **The climax:** the real brain on the Mac, given the onboarding's notes, writes the first line (20
   takes per character to tune the prompt); then the prototype speaks a real one.

## The first alpha test (2026-09-29)

One tester, new to the app, played it start to end: **finished without getting bored, and laughed at
the lines a couple of times.** The follow-ups: ask the user to play along before each waking, and
polish the sounds (decision 19).

## Decisions (the person, 2026-09-29)

1. **The orb has a voice of its own**, androgynous, human-machine (found by the user: 20, 21).
2. **The chosen character takes over fully.** Later: the orb as a playable character (an achievement).
3. **"My little self", never "stupid"** (on hold: 11).
4. **Nothing downloads without asking; every download shows progress** (bundling: 8, 17).
5. **Unit Seven is choosable on day one**, with an "are you sure?" step.
6. ~~The bodies download with the brain~~ (superseded by 17: they're in the app).
7. **The little self names itself** (on hold: 11).
8. **What's in the app is woken, not downloaded:** it says "wake", never "download", and shows the
   real loading (extended by 17).
9. **Replay by asking** ("can we start over?"): skip what's done, keep the memories.
10. **Zero internet is the normal case:** the whole onboarding plays; only the becoming waits.
11. **No little self for now.**
12. **The babble** is syllable-shaped (the hum); **your name** is letters born from the orb.
13. **Tone:** cute and approachable, a bit embarrassed, playful, simple (at best a ~3B brain carries it
    afterwards); **never "sorry"**. The person's own lines set it ("I'm just… very new, y'know",
    "hahaha. that sounds like a human, I guess… can't be sure just yet, though", "ahhh… wow! there's
    so much in there. I thought I wasn't so big!").
14. **It talks calm;** feelings come out when shown, and at moments that are feelings themselves.
15. **It listens until you've finished** speaking.
16. **The waking hums grow** with the progress.
17. **In the app: the voice, both ears and the bodies (~940 MB); only the brain downloads.**
18. **Frictionless, and the waking teaches waiting:** nothing inside the app is asked for; the only
    yes/no before the brain is the phone's own microphone question.
19. **It asks you to play along before each waking** (a tap, a hold, three taps), and does it itself if
    you don't.
20. **You find its voice by dragging it up (higher) and down (deeper).**
21. **The voice you find stays its voice:** replays, "can we start over?", the playable orb.
22. **The third act offers both:** it offers to call you back, and if you stay, it asks about you.
23. **The ears are one waking:** the quick and the sharp together.

Rules that came with them: lines never repeat, feelings may; a tone may slide but lands in the key.

## Open questions

1. **Play Store:** ~940 MB of install-time content (an install-time asset pack); check the current caps.
2. **Reaching the models:** copy them out of the install on first launch, or load them straight from
   it (sherpa-onnx's Android API takes an AssetManager; check it covers these models).
3. **Real waking times on the phone,** so the pacing stays honest.
4. **The found voice in the app:** write the blend into the voice file as an extra speaker (the file's
   header carries the speaker count); check on the phone.
5. **The little self** (on hold): an anti-assistant line that works at 350M, and whether "Luna" wins
   too often.

## The little self race (2026-09-29, `tools/host-test/littleself_eval`)

Three small models, 3-5 samples per test (name itself, add one sentence after a scripted line, a
five-line chat with an assistant trap). Raw answers in `~/Desktop/companion/host-test-results/`.

| Model | Size | Licence | Verdict |
|---|---|---|---|
| **LFM2.5 350M** (Q4_K_M) | 229 MB | LFM 1.0 (commercial use below $10M revenue) | **Winner:** short, gentle, coherent; assistant-speak ~2 in 15 turns |
| SmolLM2 135M (Q8_0) | 145 MB | Apache 2.0 | Runner-up: poetic names, but rambles and invents a family |
| Gemma 3 270M (Q4_0) | 242 MB | Gemma | Out: "Okay." "Hello!"; never names itself |

It taught: **no feeling tags** at this size (every tiny model broke on them); **naming needs a nudge,
not a name** (started as "I think I'll call myself", both named themselves 5/5, often "Luna"); and it
found an engine bug (LFM2's recurrent state can't drop its tail; fixed by starting clean).

## Background: the wake-up (~30 s to 6-8 s)

The app once took ~30 s to start and showed the wrong character first. The hidden cost was reading
the character's prompt into the brain (13-40 s). Now each character's primed prompt is saved per
brain, context and character, and loaded (81-208 ms); stale ones are primed in the background, and
any word from you cancels that. Brain and voice load side by side. See `docs/SUCCESSION_7_V.md`.
