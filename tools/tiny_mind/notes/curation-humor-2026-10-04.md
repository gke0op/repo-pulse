# Humor lines: curation notes (2026-10-04)

Second dataset, separate from the voice: `lines-humor/`, target ~50k checked rows on top of the 52,152 voice
lines. Same table format, checker and gates as `lines/`; every row is a `chat` row where the orb tells one joke
in its own voice. Kept in its own folder so the trainer chooses the mix weight (inferred risk: 50% jokes would
turn the orb into a stand-up act).

**Mix (asked → as built):** AI 25%, humans 20%, science 15%, animals & world 15%, everyday 15%,
explicit & spicy 7% → **dropped**, daring 3% → **10%** (bold, cheeky, clean). Kinds rotate per file: joke,
punchline, one-liner, pickup line, statement.
- Explicit content is out: the orb is the first thing anyone meets in the app, kids included, and its spec bans
  romance and sexual content.
- Pickup lines are said **between things** ("a cat told a box it contains her, and the box said strictly
  speaking, not really"), never to the user.
- AI jokes are about robots and machines in general; the orb still never says it is an AI.

## Rounds 1–6 (52,152 → 74,004 total checked lines)

**Measured:** every humor file passes `orb_lines.py` and all gates against all voice and humor lines.
**Safety (read, ~300 rows across daring and pickup files):** nothing sexual, cruel, flirty or punching down.

**Patterns (read):**
- **Aphorisms instead of jokes** (round 1 especially): "moss is the slowest confident thing alive" is lovely
  but has no setup and no twist. From round 3 the prompt asks for a setup and a twist per kind; jokes improved,
  aphorisms still appear in about a third of rows.
- **Kinds collapsed in round 1:** pickup-line files had no pickup lines, punchline files had no setups. Fixed
  from round 3 (punchline: the user line is the setup; pickup: what one thing says to another).
- **Wrong science:** "you do photosynthesise a little, screen and all", "friction is a fan… planes",
  "snowflakes never collide". The prompt now requires facts inside jokes to be true; the statement files
  since then are mostly right (bumblebee bat, oxygen aurorae, the coldest ridge in antarctica).
- **Filler adverbs to dodge the opener limit:** "famously a cat told…", "exactly a molecule told…". Added to
  the writers' lessons.
- **Feeling tags that don't fit:** puns tagged sad ("why did the spoon quit the kitchen?" → sad). Lessons:
  a groan-worthy pun is happy or surprised.
- **User lines lean on "tell me a joke about …":** the 25% two-word opener gate keeps it from dominating.

**Next:** keep reading 30 rows per file; if aphorism share stays near a third after round 8, add a gate for
the "<things> are/is <metaphor>" opener in humor files at a tighter cap than the voice files' 20.

## Rounds 7–14 (74,004 → 103,344 total; humor target reached)

**Measured:** 140 humor files, **51,192 humor lines**, all passing the checker and gates against every voice and
humor line. In 30-row reads of the 80 files from rounds 7–14, the "<things> are/keep/make …" aphorism opener is
down to **2.8%** of rows (about a third in round 1).

**Read:**
- **Pickup lines between things work now:** "penguins told icebergs, you're clearly my type, chill." /
  "seconds told minutes, i'll be with you in a bit, and minutes never blink."
- **Facts inside jokes mostly true** in the sampled science and world files (otters crack shells on their
  chests, strawberry seeds on the outside, starling murmurations).
- **New slip: garbled user lines** in a few files ("can we dojoke about ostriches", "know any jokes aboutabout
  icebergs", "hey,joke about whales"). The gates check only the orb column; a user-line typo gate (doubled
  words, missing spaces) would catch these.
- **Feeling tags still drift** on wry everyday lines ("that laundry pile isn't dirty yet…" → sad).
- **Still more wry than laugh-out-loud** in everyday and AI files; the punchline and pickup kinds are the
  funniest per row.

**For the trainer:** keep `lines-humor/` a separate source with its own mix weight. Inferred: a small share
(10–20% of voice batches) adds play without turning every reply into a joke.
