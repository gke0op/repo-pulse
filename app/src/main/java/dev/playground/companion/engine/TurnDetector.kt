package dev.playground.companion.engine

import android.content.Context
import java.io.File

/**
 * "Is the user done talking?" from the audio itself (pipecat-ai Smart Turn v3.2, BSD-2, 8.7 MB,
 * app/src/main/cpp/smart_turn.cpp over sherpa-onnx's ONNX Runtime). Ears asks at each short pause;
 * a confident yes ends the turn there instead of after the ~1.2 s silence rule.
 * Also carries the Silero VAD v6.2.3 model (MIT) that this A/B pairs it with.
 *
 * Mac checks (tools/host-test/turn_eval): features match transformers' WhisperFeatureExtractor to
 * 3.5e-5 and probabilities match Python onnxruntime 1.28 exactly. The int8 model's score on
 * ambiguous audio moves by up to ~0.3 across ORT versions, stable on clear cases, hence [THRESHOLD].
 */
object TurnDetector {
    /** A/B: false in build A, true in build B-turn (branch ab/turn). */
    const val ENABLED = false
    /** Only a confident "done" ends the turn early; anything less waits for the silence rule as before. */
    const val THRESHOLD = 0.9f

    init { System.loadLibrary("companion") }
    private external fun load(model: String, melFilters: String): Boolean
    /** P(turn complete) for 16 kHz audio ending now (the last 8 s are used); -1 if unavailable. */
    external fun predict(audio: FloatArray): Float

    @Volatile var ready = false; private set

    /** Copies the bundled files out of the APK (once) and loads the model. Call off the UI thread. */
    fun prepare(ctx: Context): Boolean {
        if (ready) return true
        val dir = File(ctx.filesDir, "turn").apply { mkdirs() }
        val model = asset(ctx, dir, "smart-turn-v3.2-cpu.onnx")
        val mel = asset(ctx, dir, "mel_filters_201x80.f32")
        ready = load(model.path, mel.path)
        return ready
    }

    /** Silero VAD v6.2.3, copied out of the APK. */
    fun sileroV6(ctx: Context): File = asset(ctx, File(ctx.filesDir, "turn").apply { mkdirs() }, "silero_vad_v6.2.3.onnx")

    private fun asset(ctx: Context, dir: File, name: String): File {
        val f = File(dir, name)
        if (!f.exists() || f.length() == 0L) ctx.assets.open("turn/$name").use { i -> f.outputStream().use { i.copyTo(it) } }
        return f
    }
}
