package dev.playground.companion.engine

import org.junit.Assert.assertEquals
import org.junit.Test

class SpeechTextTest {
    private fun c(s: String) = SpeechText.clean(s)

    @Test fun emphasisIsSpokenWherever_itSits() {
        // Real lines from the 2026-09-28 logs.
        assertEquals("Not just water.", c("Not *just* water."))
        assertEquals("You think I like things?", c("You think *I* like things?"))
        assertEquals("Now that’s a thought.", c("Now *that’s* a thought."))
        assertEquals("experience – that feeling", c("experience – *that* feeling"))
        assertEquals("tries to… feel", c("tries to… *feel*"))
        assertEquals("That’s a thought.", c("*That’s* a thought."))            // start of a speech chunk
        assertEquals("to truly surprise myself", c("to *truly surprise* myself"))  // two words
    }

    @Test fun unitSevensProcessingIsInCharacter() =
        assertEquals("Very well. Processing… synthesizing…", c("Very well. *Processing… synthesizing…*"))

    @Test fun actionsAreDropped() {
        assertEquals("Let me see… Dust motes dance.", c("Let me see… *pauses, a thoughtful expression* Dust motes dance."))
        assertEquals("Oh! You got me.", c("Oh! *laughs softly* You got me."))
        assertEquals("Hmm. Maybe.", c("Hmm. *a small, thoughtful pause* Maybe."))
        assertEquals("Here goes…", c("Here goes... *[Mira begins to recite a poem]*").replace("...", "…"))
    }

    @Test fun echoedReadingsAreNeverSpoken() =
        assertEquals("I am cool.", c("I am cool. <<readings: heat: cool, no slowdown>>"))

    @Test fun asidesTagsMarkdownAndEmojiGo() {
        assertEquals("Hi there!", c("Hi (waves) there! 😊"))
        assertEquals("I am fine.", c("[calm] I am fine."))
        assertEquals("A title", c("# A _title_"))
    }
}
