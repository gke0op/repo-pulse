package dev.playground.companion.engine

import dev.playground.companion.engine.Memory.Note
import dev.playground.companion.engine.Memory.Tag
import dev.playground.companion.engine.Memory.Wish
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.nio.file.Files

class WishLogTest {
    private val day = 24 * 3_600_000L

    @Test fun onlyNewWishesAreLogged() {
        val logged = listOf(Wish(1L, "to see snow for the first time."))
        val fresh = Memory.newWishes(logged, listOf(
            Note(Tag.WISH, "to see the snow for the first time."),   // near-duplicate of a logged one
            Note(Tag.YOU, "works night shifts as a nurse."),          // not a wish
            Note(Tag.WISH, "to learn how to play the cello."),
            Note(Tag.WISH, "to learn to play the cello."),            // repeated within one batch
        ))
        assertEquals(listOf("to learn how to play the cello."), fresh.map { it.text })
    }

    @Test fun promptShowsOldestWishesThatLeftTheNotesWordForWord() {
        val log = listOf(Wish(0L, "to see snow for the first time."), Wish(40 * day, "to learn how to play the cello."), Wish(50 * day, "to visit the sea together."))
        val notes = listOf(Note(Tag.WISH, "to visit the sea together."))  // still in the notes: not repeated
        val block = Memory.wishLogBlock(log, notes, now = 52 * day)
        assertTrue(block.startsWith("Older wishes you once had"))
        assertTrue(block.contains("- some time ago: to see snow for the first time."))
        assertTrue(block.contains("- 12 days ago: to learn how to play the cello."))
        assertTrue(!block.contains("sea"))
        assertEquals("", Memory.wishLogBlock(log.takeLast(1), notes, now = 52 * day))
    }

    @Test fun logIsSeededFromNotesThenOnlyAppended() {
        val dir = Files.createTempDirectory("wishlog").toFile()
        try {
            val store = MemoryStore(dir)
            store.saveNotes("girl", listOf(Note(Tag.WISH, "to see snow for the first time."), Note(Tag.US, "agreed to name the cat Biscuit.")))
            assertEquals(listOf(Wish(0L, "to see snow for the first time.")), store.wishLog("girl"))
            store.logWishes("girl", listOf(Note(Tag.WISH, "to see snow for the first time."), Note(Tag.WISH, "to learn how to play the cello.")), at = 7L)
            store.saveNotes("girl", emptyList())                      // notes forget; the log doesn't
            assertEquals(listOf(Wish(0L, "to see snow for the first time."), Wish(7L, "to learn how to play the cello.")), store.wishLog("girl"))
            assertEquals(emptyList<Wish>(), store.wishLog("boy"))
        } finally { dir.deleteRecursively() }
    }
}
