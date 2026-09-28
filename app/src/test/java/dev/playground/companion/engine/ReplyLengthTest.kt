package dev.playground.companion.engine

import org.junit.Assert.assertEquals
import org.junit.Test

class ReplyLengthTest {
    private val r = "\n(Out loud: one to three short sentences.)"
    private val l = "\n(Out loud: this time say the whole thing now, in full, no preamble.)"

    @Test fun offInBuildA() = assertEquals("Hi there.", ReplyLength.framed("Hi there.", reminder = null, longReminder = null))

    @Test fun ordinaryLinesGetTheShortReminder() =
        assertEquals("I went for a walk.$r", ReplyLength.framed("I went for a walk.", r, l))

    @Test fun longFormRequestsGetTheFullReminder() {
        for (line in listOf("Would you like to write a poem about this?", "Tell me a story", "Sing me a song!",
                            "How about a longer poem?", "Can you explain that?")) {
            assertEquals(line + l, ReplyLength.framed(line, r, l))
        }
    }

    @Test fun wordsInsideOtherWordsDontCount() =
        assertEquals("She was a songwriter's rewrite.$r", ReplyLength.framed("She was a songwriter's rewrite.", r, l))
}
