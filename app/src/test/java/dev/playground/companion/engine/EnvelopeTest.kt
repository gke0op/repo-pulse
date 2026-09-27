package dev.playground.companion.engine

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.PI
import kotlin.math.sin

class EnvelopeTest {
    private fun tone(ms: Int, amp: Float, rate: Int = 24000) =
        FloatArray(rate * ms / 1000) { (amp * sin(2 * PI * 220 * it / rate)).toFloat() }

    @Test fun oneValuePerFrame() = assertEquals(50, Envelope.of(tone(1000, 0.3f), 24000, 20).size)

    @Test fun silenceClosesTheMouth() = assertTrue(Envelope.of(FloatArray(4800), 24000).all { it == 0f })

    @Test fun loudPartOpensMoreThanSoftPart() {
        val env = Envelope.of(tone(200, 0.05f) + tone(200, 0.4f), 24000)
        assertTrue(env.take(10).average() < env.takeLast(10).average())
        assertEquals(1f, env.max(), 1e-3f)
    }
}
