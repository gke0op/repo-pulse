package dev.playground.companion.engine

import dev.playground.companion.engine.SelfReport.Snapshot
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class SelfReportTest {
    private fun snap(heat: String? = "cool (thermal status 0)", trimmed: Boolean = false, since: Long = 2 * 24 * 3_600_000L) =
        Snapshot(heat, 7.2, 4200, trimmed, since, listOf("Mira" to 3 * 3_600_000L, "Kai" to null), 12, 4)

    @Test fun firstTurnTellsTheWholeStoryThenOnlyChanges() {
        val t = SelfReport.Tracker()
        val first = t.line(snap())!!
        assertTrue(first.contains("you last talked with the user 2 days ago"))
        assertTrue(first.contains("the user last talked with Mira 3 hours ago"))
        assertTrue(first.contains("the user hasn't talked with Kai yet"))
        assertTrue(first.contains("you hold 12 memory notes, 4 of them wishes"))
        t.heard()                                                    // a heard reply refreshes the last-talked stamp
        assertNull(t.line(snap(since = 60_000L)))                    // nothing changed
        assertTrue(t.line(snap(heat = "hot (thermal status 3)", since = 60_000L))!!.contains("heat: hot"))
        t.heard()
        assertTrue(t.line(snap(heat = "hot (thermal status 3)", trimmed = true, since = 60_000L))!!.contains("trimmed"))
    }

    @Test fun readingsNobodyHeardAreSentAgain() {
        val t = SelfReport.Tracker()
        t.line(snap())            // an early start that was dropped: never heard
        assertTrue(t.line(snap())!!.contains("2 days ago"))
    }

    @Test fun memoriesWithoutAStampAreNotAFirstConversation() {
        // Stamps began in 0.14.9: on 16:01 he said "I recognize the readings, but not you."
        val line = SelfReport.Tracker().line(Snapshot(null, null, null, false, null, emptyList(), 5, 1))!!
        assertTrue(line.contains("you have talked with the user before (when is unknown)"))
        assertTrue(SelfReport.Tracker().line(Snapshot(null, null, null, false, null, emptyList(), 0, 0))!!.contains("first conversation"))
    }

    @Test fun backAfterALongGapGetsFreshReadingsWithTheTime() {
        val t = SelfReport.Tracker()
        assertTrue(t.line(snap().copy(partOfDay = "evening"))!!.contains("it is evening"))
        t.heard()
        assertNull(t.line(snap(since = 60_000L)))
        val back = t.line(snap(since = 5 * 3_600_000L).copy(partOfDay = "late at night"))!!
        assertTrue(back.contains("it is late at night"))
        assertTrue(back.contains("you last talked with the user 5 hours ago"))
    }

    private val log = listOf("# comment", "0.15.3\tyou now sense the time of day", "0.15.4\tyour ears were replaced", "0.16.0\tyou got a new voice").joinToString("\n")

    @Test fun rebuiltSaysWhatChangedSinceHisLastBuild() {
        assertEquals("you were rebuilt since you last talked with the user (0.15.2 to 0.15.4); what changed: you now sense the time of day; your ears were replaced",
            SelfReport.rebuilt(log, "0.15.2-B-all", "0.15.4-B-all"))
        assertEquals("you were rebuilt since you last talked with the user (0.15.4 to 0.16.0); what changed: you got a new voice", SelfReport.rebuilt(log, "0.15.4-A", "0.16.0-A"))
        assertNull(SelfReport.rebuilt(log, "0.15.3-A", "0.15.3-B-seven"))       // A/B switch of one version: not a rebuild
        assertTrue(SelfReport.rebuilt(log, "0.16.0", "0.16.1")!!.endsWith("what changed wasn't written down"))
        assertTrue(SelfReport.rebuilt(log, "0.16.0", "0.15.4")!!.startsWith("you were changed back to an earlier build"))
    }

    @Test fun rebuiltRidesOnTheFirstReadingsAndCountsOnceHeard() {
        val t = SelfReport.Tracker()
        val s = snap().copy(rebuilt = "you were rebuilt since you last talked with the user (0.15.2 to 0.15.3)")
        assertTrue(t.line(s)!!.contains("you were rebuilt"))
        assertTrue(t.heard())                                        // the app stamps the build now
        t.line(snap(heat = "hot (thermal status 3)", since = 60_000L))
        assertFalse(t.heard())                                       // later readings don't re-stamp
    }

    @Test fun agoReadsNaturally() {
        assertEquals("just now", SelfReport.ago(30_000))
        assertEquals("45 minutes ago", SelfReport.ago(45 * 60_000L))
        assertEquals("3 hours ago", SelfReport.ago(3 * 3_600_000L))
        assertEquals("2 days ago", SelfReport.ago(50 * 3_600_000L))
    }
}
