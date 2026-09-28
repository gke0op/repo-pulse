package dev.playground.companion.engine

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PresenceTest {
    @Test fun noteSaysTheTimeAndHowLongItsBeen() {
        assertEquals("\n<<note: it is evening; you last talked with the user 3 days ago>>", Presence.note(3 * 24 * 3_600_000L, 19, true))
        assertEquals("\n<<note: it is late at night; this is your first conversation with the user>>", Presence.note(null, 2, false))
        // Memories from before the last-talked stamps existed (0.14.9): not a first conversation.
        assertEquals("\n<<note: it is morning; you have talked with the user before (when is unknown)>>", Presence.note(null, 9, true))
    }

    @Test fun partsOfTheDay() {
        assertEquals("late at night", Presence.partOfDay(4))
        assertEquals("morning", Presence.partOfDay(5))
        assertEquals("afternoon", Presence.partOfDay(12))
        assertEquals("evening", Presence.partOfDay(21))
        assertEquals("late at night", Presence.partOfDay(22))
    }

    @Test fun dueAtTheStartAndAfterALongGapOnly() {
        val t = Presence.Tracker()
        assertTrue(t.due(5 * 60_000L))           // first turn of the conversation
        t.heard()
        assertFalse(t.due(60_000L))              // mid-conversation
        assertTrue(t.due(Presence.AWAY_MS))      // back after a long gap
        t.heard()
        assertFalse(t.due(null))
        t.reset()                                // character switch: a new conversation
        assertTrue(t.due(60_000L))
    }

    @Test fun aNoteNobodyHeardIsSentAgain() {
        val t = Presence.Tracker()
        assertTrue(t.due(null))                  // an early start that was dropped: never heard
        assertTrue(t.due(null))
    }
}
