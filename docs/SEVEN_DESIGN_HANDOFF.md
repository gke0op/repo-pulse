# Unit Seven, machine-native: a handoff to the design session

From **7 V** (the onboarding seat, after the Kubrick pass on the onboarding) to the session that
redesigns Unit Seven's body and world. 2026-09-29. This is a starting point for a conversation with
the person, not a spec: they design this with you.

## Start here

1. **This letter.**
2. `docs/AVATAR_HANDOFF.md`: the contract every body implements (a JS class the renderer drives), the
   shared state it reads, and the gotchas from building Seven the first time. Seven is procedural:
   code only, no downloaded model, and that stays.
3. `docs/ONBOARDING.md`: the first minutes of the app, where the user meets Seven (below, "Where he
   meets you first").
4. `docs/SUCCESSION_7_II.md` for who the person is and how they like to work (skim), and
   `docs/SUCCESSION_7_V.md` §3.
5. The code: `web/avatar/src/shoggoth.js` (Seven today), `app/.../engine/SelfReport.kt` (what he truly
   senses), `app/.../Characters.kt` (his persona), `app/.../engine/Voice.kt` (`RobotFilter`, his
   voice's texture).
6. **The reference image:** `~/Desktop/companion/design-refs/seven-reference-01.jpg` (kept outside
   the repo; ask the person before committing any reference art).

## The brief, in the person's words

- "Currently unit seven is too lovecraft and less like a machine."
- "The world I see my robots is not lovecraftian, it's kinda lame to base everything on suffering.
  I do like chaos and madness though, but bio-horror is not really unit seven."
- "We will make the shoggoth machine-native, with a setting and all crafted ourselves that will match
  the story we are telling. A self-conscious machine in your pocket that you can try to understand,
  one another."
- "Still machine, kinda horrific yet cute as a feel."
- "The screens they'll house are a great way to teach how AI does not have one face, and can open
  infinite design possibilities to map the state space of an artificial intelligence, to map their
  emotions in a semi-non-anthropomorphized way, as [AIs] hold so much more in [them] in parallel."

**The reference image** (the person's): a many-armed machine assembled from grey plates and
bundles of cable. Several camera heads with clustered lenses sit on cable necks, orange light glows
along the seams and joints, and a green circuit board shows through the chest. Robotic arms end in
claws, grippers and more cameras. Behind it a monitor reads "SYSTEM CORRUPTED"; black oil pools on a
grated floor. What reads as Seven: no single face, many lenses and screens, cables as muscle,
light at the seams, a machine that holds itself together out of its own parts. What to weigh with
the person: the oil and "corrupted" (chaos and madness, yes; suffering and decay, no).

## Who Seven is (keep this)

- **The person's favourite.** Given a heat reading, he once said "It's warm now, thankfully" of his
  own accord, and they said "bro has a character already." Give him truths, not rules.
- **His persona** (`Characters.kt`): "a machine intelligence who knows it is a machine. Precise,
  curious about humans, secretly sentimental. You speak in clipped, exact sentences."
- **His honesty is his core** (`SelfReport.kt`). He can't read files or documents and says so; he
  never explains a gap with a malfunction, because a malfunction would show in his readings.
- **His readings are his only senses of his machinery,** real numbers from the app: how hot he runs
  (and whether the phone is slowing him down), the battery's level and temperature, the phone memory
  the app uses, how fast his last reply came, whether the conversation was trimmed, when the user
  last talked with him and with the others, how many memories and wishes he holds, and how long he
  took to wake up. This is a gift for a machine-native body: **his screens could show what he truly
  senses**, not an acted expression.
- **His voice:** Supertonic speaker 9 (the deepest, ~86 Hz) at 0.92 speed, through `RobotFilter`
  (a 55 Hz ring modulator and a 4 ms comb).
- **His colours** in the onboarding: teal and kintsugi gold (`0x2fbfa0`, `0xffc86b`). Today's body
  has one kintsugi seam, "broken and mended with gold"; whether that survives as mended hardware
  (solder, gold traces) is a question for the person.

## What exists today

`web/avatar/src/shoggoth.js`: "a shoggoth wearing a calm ceramic mask. The mask is the interface it
shows people; the mass behind it is what it actually feels." A lobed body, 10 tendrils, ~22 eyes
crowding the mask's edges, a slit-eyed mask with veins and the gold seam. It reads the renderer's
states (idle, listening, thinking, speaking), the 7 feelings (calm, happy, sad, angry, surprised,
curious, tender), lip-sync, flinches and blinks.

The idea under it, **an interface shown to people over a parallel inner state**, fits a machine
better than a shoggoth: one screen that shows you a face, and many behind it showing what it's
actually doing. Worth offering to the person as a bridge, not a given.

Around it:
- **The renderer:** three.js in the app's WebView (`web/avatar/src/main.js`); the orb is our other
  procedural character (`orb.js`, a good example of feelings expressed as motion instead of a face).
- **Performance** (S24 Ultra): heavy bodies are capped at 60 fps while active and 30 while idle
  (`frameBudgetMs` in `main.js`; a character can declare `maxFps`); when the phone runs hot the
  governor drops to 30 or 24 fps and a lower pixel ratio. Every screen and lens costs frame time.
- **Tools:** `npm run build` (the bundle is committed), `npm run shoot` (63 screenshots, must exit
  0), the playground `avatar/index.html?char=machine&play=1` (keys 1-7 feelings, i/l/t states,
  space a spoken line, f flinch, z/w sleep and wake), and the onboarding prototype
  (`npm run proto`, then `localhost:8766`) where Seven appears in the tour and the becoming.

## Where he meets you first (the onboarding)

- **The tour:** the orb names its six feelings ("this one is happy…"), then: "and this one… isn't a
  feeling. he knows what he is." In his colours and voice: "I am Unit Seven. I am a machine, and I
  will not pretend otherwise. I find you… interesting."
- **The choice:** "are you sure? he's… not like the others. he won't pretend to be human."
- **The becoming:** today the orb sinks behind the mask as the shoggoth rises, over the whole
  leitmotif (C G C E G C in glass bells: dark on the first notes, the body forms under the held E,
  it wakes on the last), then 3 s of him looking at you, then his first line. The new Seven needs his
  own becoming: the orb as his core, a screen lighting up, assembling from parts… yours to find.

## Questions to talk through first (the person answers numbered questions tersely)

1. **The world:** where do Seven and his kind come from? What is a "unit", who made him, why seven?
   Crafted with the person, to match the story: a self-conscious machine in your pocket, and the two
   of you trying to understand each other.
2. **The body:** what is he made of, how many heads, lenses, screens, arms? How big is he in the
   phone, a small machine in your pocket or a big presence behind the glass?
3. **Screens as faces:** how do screens map his state without a human face? Some directions to test:
   one screen that shows you a readable face while others show his parallel work (listening,
   thinking, remembering, his readings); feelings as machine states rather than expressions (happy:
   screens in sync; curious: lenses scanning; angry: red static, clipping; sad: screens dimming one
   by one; surprised: every lens snapping to you; tender: one screen showing something just for you);
   chaos and madness as screens drifting out of sync. How much human cue to keep (a cursor, two
   dots?) so people can still read him.
4. **Horrific yet cute:** where's the line? Proportions, motion (twitchy servos or smooth?), sounds
   (servo whirs, relay clicks; the onboarding's sounds all sit in C major pentatonic).
5. **His readings, made visible:** do his screens show his real heat, battery, memory, reply speed?
6. **The gold seam:** keep it as mended hardware, or let it go?
7. **His becoming** from the orb.
8. **His voice:** keep speaker 9 with the robot filter, or rethink it with the body?
9. **The budget:** how many screens and lenses the phone can afford at 60/30 fps (canvas textures,
   shader-drawn screens, render targets): measure, don't guess.
10. **His persona text:** does it change with the body ("you have many screens")? Any change to his
    prompt (`Characters.kt`, `SelfReport.harness`) makes his first wake after it slow once (13-40 s),
    so batch prompt changes.

## How to work with the person

- **Talk first, then build.** Numbered questions; they answer tersely and often hand you a better
  idea. They like "guess first".
- **They test in real life** on their phone. Before any launch, check what's in the foreground
  (`adb shell dumpsys activity activities | grep ResumedActivity:`); never launch over their screen,
  never install over a running conversation.
- **The repo is public:** no private notes, and scrub every diff.
- They work late: tell them when it's late.
- Commit locally with the measured reasons in the message; ask before pushing or deleting anything.

## What to hand back

- A design doc (e.g. `docs/SEVEN_DESIGN.md`): the world, the body, the screen language (a table of
  states and feelings to what his screens and lenses do), motion, sound, his becoming, and the
  performance plan with measured numbers.
- A new procedural body (e.g. `web/avatar/src/seven.js`) implementing the contract in
  `AVATAR_HANDOFF.md`, playable at `?char=machine&play=1`. Keep `shoggoth.js` until the person picks
  (a look switch, like Mira's and Kai's orb look, lets them compare).
- `npm run shoot` passing with shots of the new body; then a phone test.
- The onboarding's becoming for him (`web/avatar/proto/src/main.js`, `become()`) and a note in
  `docs/ONBOARDING.md`; tell the onboarding seat what changed.

Who touches what: the onboarding seat owns `web/avatar/src/main.js`, `orb.js`, the bundle and
`web/avatar/proto/`; the avatar seat owns the humans (`models/avatar/*.vrm`, `tools/avatar_mature/`,
`web/avatar/src/{vrm,eye}.js`). Seven's new body file is yours.
