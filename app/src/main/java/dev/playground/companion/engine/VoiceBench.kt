package dev.playground.companion.engine

import android.os.SystemClock
import java.io.File

/**
 * Times every downloaded voice engine on this device (CPU, 2/4/6 threads),
 * so we choose the voice from data, not guesses.
 */
object VoiceBench {
    private const val SHORT = "He's the owner!"
    private const val LONG = "Honestly, I think the rain makes everything feel a little softer, don't you?"

    /** progress(status, reportSoFar): results appear as they come, in case an engine crashes natively. */
    fun run(engines: List<Pair<VoiceEngine, File>>, characterId: String, progress: (String, String) -> Unit): String = buildString {
        appendLine("VOICE BENCH (cpu)")
        appendLine("  engine        thr   load  short(ms)  long synth/audio   RTF")
        for ((engine, dir) in engines) for (threads in listOf(2, 4, 6)) {
            progress("Benchmarking ${engine.label} x$threads…", toString())
            val line = try {
                var t = SystemClock.elapsedRealtime()
                val v = Voice(engine, dir, threads)
                val loadMs = SystemClock.elapsedRealtime() - t
                try {
                    val sid = engine.speakerFor(characterId)
                    v.synth("Hi.", sid, 1f) // warm-up: first run pays graph init
                    t = SystemClock.elapsedRealtime()
                    v.synth(SHORT, sid, 1f)
                    val shortMs = SystemClock.elapsedRealtime() - t
                    t = SystemClock.elapsedRealtime()
                    val samples = v.synth(LONG, sid, 1f)
                    val longMs = SystemClock.elapsedRealtime() - t
                    val audioMs = samples.size * 1000L / v.sampleRate
                    "  %-12s  %3d  %5d  %8d   %6d / %-6d  %.2f".format(
                        engine.label, threads, loadMs, shortMs, longMs, audioMs, longMs.toDouble() / audioMs,
                    )
                } finally {
                    v.release()
                }
            } catch (e: Throwable) {
                "  %-12s  %3d  failed: %s".format(engine.label, threads, e.message ?: e.javaClass.simpleName)
            }
            appendLine(line)
        }
        progress("Bench done", toString())
    }.trimEnd()
}
