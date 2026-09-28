package dev.playground.companion.engine

import dev.playground.companion.engine.ThermalGovernor.Level
import org.junit.Assert.assertEquals
import org.junit.Test

class ThermalGovernorTest {
    private fun d(h: Float, status: Int, cur: Level) = ThermalGovernor.decide(h, status, cur)

    @Test fun stepsUpWithHeadroom() {
        assertEquals(Level.COOL, d(0.82f, 1, Level.COOL))
        assertEquals(Level.WARM, d(0.86f, 1, Level.COOL))
        assertEquals(Level.HOT, d(0.96f, 2, Level.WARM))
        assertEquals(Level.HOT, d(0.70f, 3, Level.COOL)) // severe status wins over headroom
    }

    @Test fun hysteresisOnTheWayDown() {
        assertEquals(Level.WARM, d(0.82f, 1, Level.WARM)) // not below 0.80 yet
        assertEquals(Level.COOL, d(0.79f, 1, Level.WARM))
        assertEquals(Level.HOT, d(0.92f, 2, Level.HOT))
        assertEquals(Level.WARM, d(0.88f, 2, Level.HOT))
        assertEquals(Level.HOT, d(0.50f, 3, Level.HOT))  // still severe
    }

    @Test fun noHeadroomFallsBackToStatus() {
        assertEquals(Level.COOL, d(Float.NaN, 1, Level.COOL))
        assertEquals(Level.WARM, d(Float.NaN, 2, Level.COOL))
        assertEquals(Level.HOT, d(Float.NaN, 3, Level.COOL))
        assertEquals(Level.HOT, d(Float.NaN, 1, Level.HOT))   // a missing reading never flaps it down
        assertEquals(Level.WARM, d(Float.NaN, 0, Level.WARM))
    }
}
