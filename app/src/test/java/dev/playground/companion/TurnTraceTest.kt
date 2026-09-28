package dev.playground.companion

import org.junit.Assert.assertEquals
import org.junit.Test

class TurnTraceTest {
    @Test fun gapsAreLateStartsOnly() {
        val t = TurnTrace(1, "x", 0)
        t.plays += TurnTrace.Play(1000, 800)  // plays 1000..1800
        t.plays += TurnTrace.Play(1750, 2000) // queued in time (starts while the buffer still holds chunk 1)
        t.plays += TurnTrace.Play(4500, 500)  // chunk 2 ended at 3750: 750 ms of silence
        assertEquals(listOf(0L, 750L), t.gaps())
        assert(t.report().contains("gaps        : 1 (total 750 ms, longest 750 ms, after the first chunk 0 ms)"))
    }
}
