package dev.playground.companion.engine

import android.os.SystemClock
import java.io.File

/**
 * Measures Kokoro under different ONNX Runtime providers and thread counts on this device,
 * so we pick the voice config from data, not guesses.
 */
object VoiceBench {
    private const val SHORT = "He's the owner!"
    private const val LONG = "Honestly, I think the rain makes everything feel a little softer, don't you?"

    private val CONFIGS = listOf(
        "cpu" to 1, "cpu" to 2, "cpu" to 4, "cpu" to 6,
        "xnnpack" to 2, "xnnpack" to 4,
        "nnapi" to 1,
    )

    /** progress(status, reportSoFar): results appear as they come, in case a provider crashes natively. */
    fun run(modelDir: File, speakerId: Int, progress: (String, String) -> Unit): String = buildString {
        appendLine("VOICE BENCH (Kokoro int8, sid $speakerId)")
        appendLine("  provider  thr   load   short(ms)   long synth/audio   RTF")
        for ((provider, threads) in CONFIGS) {
            progress("Benchmarking voice: $provider x$threads…", toString())
            val line = try {
                var t = SystemClock.elapsedRealtime()
                val v = Voice(modelDir, threads, provider)
                val loadMs = SystemClock.elapsedRealtime() - t
                try {
                    v.synth("Hi.", speakerId, 1f) // warm-up: first run pays graph init
                    t = SystemClock.elapsedRealtime()
                    v.synth(SHORT, speakerId, 1f)
                    val shortMs = SystemClock.elapsedRealtime() - t
                    t = SystemClock.elapsedRealtime()
                    val samples = v.synth(LONG, speakerId, 1f)
                    val longMs = SystemClock.elapsedRealtime() - t
                    val audioMs = samples.size * 1000L / v.sampleRate
                    "  %-8s  %3d  %5d   %9d   %6d / %-6d   %.2f".format(
                        provider, threads, loadMs, shortMs, longMs, audioMs, longMs.toDouble() / audioMs,
                    )
                } finally {
                    v.release()
                }
            } catch (e: Throwable) {
                "  %-8s  %3d  failed: %s".format(provider, threads, e.message ?: e.javaClass.simpleName)
            }
            appendLine(line)
            progress("Benchmarking voice…", toString())
        }
    }.trimEnd()
}
