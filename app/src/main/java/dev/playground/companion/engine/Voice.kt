package dev.playground.companion.engine

import com.k2fsa.sherpa.onnx.OfflineTts
import com.k2fsa.sherpa.onnx.OfflineTtsConfig
import com.k2fsa.sherpa.onnx.OfflineTtsKokoroModelConfig
import com.k2fsa.sherpa.onnx.OfflineTtsModelConfig
import java.io.File
import kotlin.math.PI
import kotlin.math.sin

/** Kokoro TTS via sherpa-onnx. One instance serves all characters (voice = speaker id). */
class Voice(modelDir: File, threads: Int) {
    private val tts = OfflineTts(
        config = OfflineTtsConfig(
            model = OfflineTtsModelConfig(
                kokoro = OfflineTtsKokoroModelConfig(
                    model = File(modelDir, "model.int8.onnx").path,
                    voices = File(modelDir, "voices.bin").path,
                    tokens = File(modelDir, "tokens.txt").path,
                    dataDir = File(modelDir, "espeak-ng-data").path,
                ),
                numThreads = threads,
                provider = "cpu",
            ),
        ),
    )

    val sampleRate: Int = tts.sampleRate()

    fun synth(text: String, speakerId: Int, speed: Float): FloatArray =
        tts.generate(text, sid = speakerId, speed = speed).samples

    fun release() = tts.release()
}

/**
 * Cheap "machine" coloring: ring modulation plus a short metallic comb.
 * Keeps phase across chunks so consecutive sentences don't click.
 */
class RobotFilter(private val sampleRate: Int, private val ringHz: Double = 55.0) {
    private var phase = 0.0
    private val comb = FloatArray((sampleRate * 0.004).toInt()) // 4 ms
    private var combPos = 0

    fun apply(x: FloatArray): FloatArray {
        val out = FloatArray(x.size)
        val step = 2 * PI * ringHz / sampleRate
        for (i in x.indices) {
            val ring = x[i] * sin(phase).toFloat()
            phase += step
            if (phase > 2 * PI) phase -= 2 * PI
            val dry = 0.45f * x[i] + 0.55f * ring
            val y = dry + 0.35f * comb[combPos]
            comb[combPos] = y
            combPos = (combPos + 1) % comb.size
            out[i] = (y * 0.8f).coerceIn(-1f, 1f)
        }
        return out
    }
}
