package dev.playground.companion.engine

import org.junit.Assert.assertEquals
import org.junit.Test

class SentenceChunkerTest {
    private fun feed(text: String, pieceLen: Int = 3): List<String> {
        val c = SentenceChunker()
        val out = mutableListOf<String>()
        text.chunked(pieceLen).forEach { out += c.push(it) }
        c.flush()?.let { out += it }
        return out
    }

    @Test fun firstChunkBreaksAtClauseForFastStart() {
        assertEquals(
            listOf("Oh wow, that sounds rough,", "honestly.", "I'm here though."),
            feed("Oh wow, that sounds rough, honestly. I'm here though."),
        )
    }

    @Test fun shortOpeningClauseWaitsForSentence() {
        assertEquals(listOf("Hey, you.", "What's up?"), feed("Hey, you. What's up?"))
    }

    @Test fun laterChunksBreakAtSentencesOnly() {
        assertEquals(
            listOf("Sure.", "I like tea, coffee, and rain.", "Bye!"),
            feed("Sure. I like tea, coffee, and rain. Bye!"),
        )
    }

    @Test fun abbreviationsAndDecimalsDoNotSplit() {
        assertEquals(
            listOf("Dr. Smith paid 3.5 dollars.", "Wild."),
            feed("Dr. Smith paid 3.5 dollars. Wild."),
        )
    }

    @Test fun quotedSentenceEnd() {
        assertEquals(listOf("She said \"hi.\"", "Then left."), feed("She said \"hi.\" Then left."))
    }

    @Test fun boundaryNeedsFollowingWhitespace() {
        val c = SentenceChunker()
        assertEquals(emptyList<String>(), c.push("Done."))
        assertEquals(listOf("Done."), c.push(" Next"))
        assertEquals("Next", c.flush())
    }

    @Test fun longFirstSentenceBreaksBeforeConjunction() {
        assertEquals(
            listOf("Yes, I'm here to be your cheerful companion", "and help you out whenever you need!", "Cool?"),
            feed("Yes, I'm here to be your cheerful companion and help you out whenever you need! Cool?"),
        )
    }

    @Test fun shortFirstSentenceIsNotCutAtConjunction() {
        assertEquals(listOf("Tea and cake.", "Yes."), feed("Tea and cake. Yes."))
    }

    @Test fun speechTextKeepsEmphasisButDropsActions() {
        assertEquals("Are you doing alright?", SpeechText.clean("Are *you* doing alright?"))
        assertEquals("Tell me one good thing.", SpeechText.clean("Tell me *one* good thing."))
        assertEquals("Hi.", SpeechText.clean("*waves* Hi."))
        assertEquals("Okay.", SpeechText.clean("Okay. *sighs deeply*"))
        assertEquals("Hi there.", SpeechText.clean("[Happy] Hi there."))
        assertEquals("Item 1 stays.", SpeechText.clean("Item [1] stays."))  // brackets are markdown to the voice
    }

    @Test fun speechTextStripsActionsAndEmoji() {
        assertEquals("Hi there!", SpeechText.clean("*smiles* Hi there! 😊"))
        assertEquals(false, SpeechText.speakable(SpeechText.clean("*waves*")))
    }
}
