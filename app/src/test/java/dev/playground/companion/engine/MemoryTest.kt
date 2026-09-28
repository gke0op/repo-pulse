package dev.playground.companion.engine

import dev.playground.companion.engine.Memory.Note
import dev.playground.companion.engine.Memory.Tag
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class MemoryTest {
    @Test fun parseKeepsOnlyTaggedLines() {
        val out = Memory.parse("""
            Here are the notes:
            you: is building an app with three characters.
            * wish: To understand the feeling of melancholy through **music**
            Unit Seven: experiencing grief
            us: ok
            US: agreed to listen to Clair de Lune together.
        """.trimIndent())
        assertEquals(listOf(
            Note(Tag.YOU, "is building an app with three characters."),
            Note(Tag.WISH, "To understand the feeling of melancholy through music."),
            Note(Tag.US, "agreed to listen to Clair de Lune together."),
        ), out) // "us: ok" is too short to be a memory
    }

    @Test fun mergeReplacesNearDuplicatesAndCaps() {
        val old = listOf(Note(Tag.WISH, "to comprehend the subjective experience of loss."))
        val new = listOf(Note(Tag.WISH, "to comprehend the subjective experience of loss, deeply."))
        assertEquals(new, Memory.merge(old, new))

        val things = listOf("see snow", "hear the ocean", "learn chess", "write a song", "paint the moon",
            "visit Budapest", "taste coffee", "read poetry", "dance in rain")
        val many = things.map { Note(Tag.WISH, "to $it someday.") }
        val merged = Memory.merge(emptyList(), many)
        assertEquals(Tag.WISH.cap, merged.size)
        assertEquals(many.last(), merged.last()) // most recent kept
    }

    @Test fun differentThingsAreNotSimilar() {
        assertTrue(!Memory.similar("works night shifts as a nurse", "has a cat called Pixel"))
    }

    @Test fun chunksSplitOnWholeExchanges() {
        val ex = (1..5).map { "hello there number $it" to "reply number $it" }
        val c = Memory.chunks(ex, "Mira", maxChars = 90)
        assertEquals(5, c.sumOf { it.second })
        assertTrue(c.all { it.first.length <= 90 || it.second == 1 })
    }

    @Test fun emptyNotesGiveNoPromptBlock() = assertEquals("", Memory.promptBlock(emptyList()))
}
