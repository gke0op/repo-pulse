package dev.playground.companion.engine

import android.content.Context
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.PowerManager

/**
 * Trades avatar smoothness for heat. On the S24 a 50-minute chat went from thermal status 0 to 4;
 * by status 3 the brain ran at 4-5 tok/s (7-8 cool) and the voice's RTF passed 1.0, so speech could
 * stutter. The avatar is the one load we can shed without the user losing words.
 *
 * Polls the thermal headroom (1.0 = the OS starts throttling) and steps between [Level]s with
 * hysteresis so it doesn't flap. Main thread only.
 */
class ThermalGovernor(ctx: Context, private val onLevel: (Level) -> Unit) {
    enum class Level(val fps: Int, val pixelRatio: Float) { COOL(120, 2f), WARM(30, 1.5f), HOT(24, 1.25f) }

    private val power = ctx.getSystemService(PowerManager::class.java)
    private val handler = Handler(Looper.getMainLooper())
    var level = Level.COOL; private set
    /** The last reading, for the turn report: only this class calls the API (Android returns NaN when asked >1/s). */
    @Volatile var lastHeadroom = Float.NaN; private set
    @Volatile var lastStatus = 0; private set
    private var lastRealAt = 0L

    private val poll = object : Runnable {
        override fun run() {
            lastHeadroom = headroom(); lastStatus = power.currentThermalStatus
            val now = android.os.SystemClock.elapsedRealtime()
            if (!lastHeadroom.isNaN()) lastRealAt = now
            val next = decide(lastHeadroom, lastStatus, level, recentReal = lastRealAt > 0 && now - lastRealAt < 60_000)
            if (next != level) { level = next; onLevel(next) }
            handler.postDelayed(this, POLL_MS)
        }
    }

    fun start() { handler.removeCallbacks(poll); handler.post(poll) }
    fun stop() = handler.removeCallbacks(poll)

    private fun headroom(): Float = if (Build.VERSION.SDK_INT >= 30) power.getThermalHeadroom(0) else Float.NaN

    companion object {
        const val POLL_MS = 10_000L

        /**
         * Up at 0.85 / 0.95 headroom (or status >= 3), back down only 0.05 below that. NaN headroom:
         * a gap in otherwise real readings ([recentReal]) holds the level, so it can't flap to COOL;
         * with no readings at all (API 29, or a HAL without headroom) status alone decides, both ways.
         */
        fun decide(headroom: Float, status: Int, current: Level, recentReal: Boolean = false): Level {
            if (headroom.isNaN()) return when {
                status >= PowerManager.THERMAL_STATUS_SEVERE -> Level.HOT
                recentReal -> if (status >= PowerManager.THERMAL_STATUS_MODERATE && current == Level.COOL) Level.WARM else current
                status >= PowerManager.THERMAL_STATUS_MODERATE -> Level.WARM
                else -> Level.COOL
            }
            val h = headroom
            val hot = h >= 0.95f || status >= PowerManager.THERMAL_STATUS_SEVERE
            val warm = h >= 0.85f
            return when (current) {
                Level.COOL -> if (hot) Level.HOT else if (warm) Level.WARM else Level.COOL
                Level.WARM -> if (hot) Level.HOT else if (h < 0.80f) Level.COOL else Level.WARM
                Level.HOT -> if (h < 0.80f && status < PowerManager.THERMAL_STATUS_SEVERE) Level.COOL
                             else if (h < 0.90f && status < PowerManager.THERMAL_STATUS_SEVERE) Level.WARM else Level.HOT
            }
        }
    }
}
