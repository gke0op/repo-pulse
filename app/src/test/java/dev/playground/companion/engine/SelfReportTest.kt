package dev.playground.companion.engine

import dev.playground.companion.engine.SelfReport.Snapshot
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class SelfReportTest {
    private fun snap(heat: String? = "cool (thermal status 0)", trimmed: Boolean = false) =
        Snapshot(heat, 7.2, 4200, trimmed, 2 * 24 * 3_600_000L, listOf("Mira" to 3 * 3_600_000L, "Kai" to null), 12, 4)

    @Test fun firstTurnTellsTheWholeStoryThenOnlyChanges() {
        val t = SelfReport.Tracker()
        val first = t.line(snap())!!
        assertTrue(first.contains("you last talked with the user 2 days ago"))
        assertTrue(first.contains("the user last talked with Mira 3 hours ago"))
        assertTrue(first.contains("the user hasn't talked with Kai yet"))
        assertTrue(first.contains("you hold 12 memory notes, 4 of them wishes"))
        t.heard()
        assertNull(t.line(snap()))                                   // nothing changed
        assertTrue(t.line(snap(heat = "hot (thermal status 3)"))!!.contains("heat: hot"))
        t.heard()
        assertTrue(t.line(snap(heat = "hot (thermal status 3)", trimmed = true))!!.contains("trimmed"))
    }

    @Test fun readingsNobodyHeardAreSentAgain() {
        val t = SelfReport.Tracker()
        t.line(snap())            // an early start that was dropped: never heard
        assertTrue(t.line(snap())!!.contains("2 days ago"))
    }

    @Test fun notesWithoutAStampMeanEarlierTalksNotNone() {
        val s = snap()
        assertTrue(SelfReport.Tracker().line(s.copy(sinceLastTalkMs = null))!!.contains("you have talked with the user before (when is unknown)"))
        assertTrue(SelfReport.Tracker().line(s.copy(sinceLastTalkMs = null, notes = 0, wishes = 0))!!.contains("this is your first conversation with the user"))
    }

    @Test fun agoReadsNaturally() {
        assertEquals("just now", SelfReport.ago(30_000))
        assertEquals("45 minutes ago", SelfReport.ago(45 * 60_000L))
        assertEquals("3 hours ago", SelfReport.ago(3 * 3_600_000L))
        assertEquals("2 days ago", SelfReport.ago(50 * 3_600_000L))
    }
}
