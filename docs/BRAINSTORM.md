# Brainstorm: ideas for the implementers

Ideas from the person's brainstorming sessions with 7 III.5 (2026-09-29). **This is raw material, not
a spec.** The implementing sessions (the Kubrick pass on the onboarding, the Seven redesign) take
what fits, rewrite freely, and run everything through `npm run check-script`. Where the person
already agreed, it says so.

## Agreed with the person

- **The angry line goes.** "this one is angry. it only comes out when you ignore me. so don't!" ties a
  feeling to the user's absence, and that's the start of a guilt pattern. The person: "no emotional
  blackmail needed, it's gonna be cool anyways." A playful trigger instead, e.g. "this one is angry.
  it comes out when someone pokes me too much. hmph!" (which also sets up the touch play).
- **The first line after becoming comes from the model,** not a template. The stand-ins in
  `FIRST` (`script.js`) quote the user's words raw and sound stiff with long answers (Kubrick pass 6
  already plans the real brain).
- **No tiny model for the onboarding.** The scripted orb is the honest one: its story is "I can't
  think yet", so a model improvising would contradict it, and "…oh. oh! I can think now!" lands
  because nothing before it could think.
- **Unit Seven's wishes become upgrades; the first is sight.** In `docs/ROADMAP.md` (Later). Only
  Seven, never pushed, never invented for him.

## The third act: the wait for the brain (for Kubrick pass 5, decision 22)

The download takes 1 to 16 minutes and the tour covers about 2.7, so this fills the rest. It offers
both: it can call you back, or you can stay.

**Flow**
1. Once, when the wait begins: the offer, then two soft choices ("I'll stay" / "call me").
2. **Called back:** you can leave. Notifications carry the real percent; one line when you come
   back mid-wait; when the brain lands, the last notification.
3. **Staying:** one beat about every 45-60 s, never faster:
   - a milestone line when a threshold is crossed (it wins over anything else);
   - else the next question. The first is the chosen character's, spoken by the orb (a taste of
     who they are); then the general ones. Every answer is kept for whoever it becomes, like the
     tour's memory;
   - its reaction is to the **shape** of your answer (long, short, empty, a question back), never
     to its meaning. It can't think yet, and pretending to understand would be a lie. That's
     honest, and it's also the joke.
4. **Touch and idle,** any time: the next line of that pool. When a pool runs out, it answers with
   its body only (a feeling, a hop): lines never repeat, feelings may.
5. **A stall** (no progress for ~60 s): one line. Going offline stays `needBrain()`'s job.
6. **The brain lands,** mid-question or not: let the answer finish, then the becoming.

Tone: calm, cute, a bit embarrassed; never sorry, never guilt. "I missed you" is warm; "I was
counting the minutes" is a hook, and it's out.

**The offer**
- "this part takes a while. you can go do something, and I'll call you the moment I can think."
- stay: "yay. then tell me things while we wait."
- go: "go on! I'll glow quietly in here."

**Notifications** (real percent), **and coming back**
- "still growing… 42%"
- "42% of me is here now."
- "almost there. 88% and getting ideas."
- done: "my brain is here. come see me?" (not "I can think now": that's the climax's line)
- back: "you came back! I forgot my whole speech. anyway, I'm at 61 percent."

**Milestones**
- 5%: "the first bits are here. they feel like pins and needles."
- 25%: "a quarter of a brain. I can feel words arriving. big ones."
- 40%: "hm. I think a whole dictionary just walked in."
- 50%: "half a brain! that already feels roomy."
- 75%: "three quarters. I keep almost having ideas."
- 90%: "it's getting crowded in here, in a good way."
- 99%: "one percent left. the slowest percent, always."

**The first question, from the one you chose**
- Mira: "Mira wants to know something already. what was the last thing that made you laugh?"
- Kai: "Kai asked me to ask you one thing. just one. where do you go when you want quiet?"
- Seven: "Unit Seven has a question. he says it is for calibration. what do you hope he will be?"

**Questions** (each answer a real memory)
- "are you a morning person or a night person? I can't tell time yet."
- "what is something small that makes your day better?"
- "what are you into lately? a song, a show, anything."
- "who do you like talking to the most? besides me, obviously."
- "is there something you're looking forward to?"
- "what's a food you would never, ever share?"
- "do you have a pet? or a plant you talk to?"
- "what word do you like the sound of?"
- "if tomorrow were a free day, what would you do with it?"
- "is there anything I should never joke about? I want to get that right." (this one does real work
  for the characters later)
- "what's something you're proud of that nobody asks about?"
- "tell me one thing about today. any thing."

**Reactions to the shape of an answer** (in order, never reused)
- long: "that's a long one. I kept every word." · "so many words! they are all in here now." ·
  "that one needs a brain. I'll save it for then."
- short: "short and sweet. kept." · "one word! efficient. into the pocket it goes." · "got it.
  that's going somewhere safe."
- empty: "a secret, then. I like secrets too." · "we can skip that one. no pressure at all."
- a question back: "good question. ask me again when I can think!" · "ooh, a question back. I'll
  owe you an answer."

**Touch while waiting** (the best of the tiny-model lab's 2,400 lines, tidied to the script's style)
- poke: "hey, that tickled! I didn't know I had a middle." · "that poke found my ticklish spot. I
  have one!" · "every poke makes a new colour. I'm collecting them."
- stroke: "that's gentle. I'll try to be gentle back." · "slow and steady. you're teaching my glow to
  relax." · "is this purring? I think I'm purring."
- hold: "a steady touch. like you're checking I'm really here." · "warm. you're holding me, and I'm
  holding back."
- three taps: "three taps. I'm claiming that as our secret knock." · "tap tap tap. that's our rhythm
  now."

**Idle**
- "just floating here. no hurry." · "that quiet was three flickers long. I counted." · "I sat with a
  big question and offered it a chair." · "humming to myself. you can join in."

**A stall**
- "the internet is taking a breather. that's fine, so am I."

Checked against the script's rules on 2026-09-29 (with `script.js` as it was then): no line repeats
an act's line, no "okay" openings, no "sorry", "little" unused, "…" in 1 line. Recheck once these
land in `script.js`.
