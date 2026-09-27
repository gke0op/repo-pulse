package dev.playground.companion.engine

import kotlin.math.sqrt

/** Loudness envelope of a speech chunk, for lip-sync: one value in 0..1 per [frameMs]. */
object Envelope {
    /** Frames quieter than this RMS are silence (mouth closed). */
    private const val GATE = 0.008f

    fun of(samples: FloatArray, sampleRate: Int, frameMs: Int = 20): FloatArray {
        val frame = (sampleRate * frameMs / 1000).coerceAtLeast(1)
        val n = (samples.size + frame - 1) / frame
        val rms = FloatArray(n) { i ->
            var sum = 0.0
            val from = i * frame
            val to = minOf(from + frame, samples.size)
            for (j in from until to) sum += samples[j] * samples[j]
            sqrt(sum / (to - from)).toFloat()
        }
        // Normalize per chunk so quiet and loud voices move the mouth alike; sqrt opens it more on soft syllables.
        val peak = (rms.maxOrNull() ?: 0f).coerceAtLeast(0.02f)
        return FloatArray(n) { i -> if (rms[i] < GATE) 0f else sqrt((rms[i] / peak).coerceIn(0f, 1f)) }
    }
}
