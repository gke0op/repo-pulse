package dev.playground.companion.engine

import org.junit.Assert.assertEquals
import org.junit.Test

class SentenceChunkerRampTest {
    private fun feed(text: String, c: SentenceChunker): List<String> {
        val out = mutableListOf<String>()
        text.chunked(3).forEach { out += c.push(it) }
        c.flush()?.let { out += it }
        return out
    }

    @Test fun rampBreaksTheSecondChunkAtAClause() {
        val text = "Oh, wow! That is a truly staggering thought, the idea that consciousness could expand. Yes."
        assertEquals(listOf("Oh, wow!", "That is a truly staggering thought, the idea that consciousness could expand.", "Yes."),
            feed(text, SentenceChunker()))
        assertEquals(listOf("Oh, wow!", "That is a truly staggering thought,", "the idea that consciousness could expand.", "Yes."),
            feed(text, SentenceChunker(rampChunks = 1)))
    }
}
