package dev.playground.companion.engine

import com.k2fsa.sherpa.onnx.OfflineTts
import com.k2fsa.sherpa.onnx.OfflineTtsConfig
import com.k2fsa.sherpa.onnx.OfflineTtsKokoroModelConfig
import com.k2fsa.sherpa.onnx.OfflineTtsModelConfig
import com.k2fsa.sherpa.onnx.OfflineTtsSupertonicModelConfig
import java.io.File
import kotlin.math.PI
import kotlin.math.sin

/**
 * The swappable voice engines. Speaker ids per character:
 *  Kokoro v0.19: 1=af_bella, 6=am_michael, 9=bm_george.
 *  Supertonic 3: 0-4 female, 5-9 male (sorted by measured pitch; 9 is deepest).
 */
enum class VoiceEngine(
    val label: String,
    val dirName: String,
    val url: String,
    val approxMb: Int,
    private val speakers: Map<String, Int>,
) {
    KOKORO_INT8(
        "Kokoro int8", "kokoro-int8-en-v0_19", tts("kokoro-int8-en-v0_19"), 103,
        mapOf("girl" to 1, "boy" to 6, "machine" to 9),
    ),
    KOKORO_FP32(
        "Kokoro fp32", "kokoro-en-v0_19", tts("kokoro-en-v0_19"), 320,
        mapOf("girl" to 1, "boy" to 6, "machine" to 9),
    ),
    SUPERTONIC3(
        "Supertonic 3", "sherpa-onnx-supertonic-3-tts-int8-2026-05-11",
        tts("sherpa-onnx-supertonic-3-tts-int8-2026-05-11"), 129,
        mapOf("girl" to 1, "boy" to 6, "machine" to 9),
    );

    fun speakerFor(characterId: String) = speakers[characterId] ?: 0

    fun config(dir: File, threads: Int, provider: String): OfflineTtsModelConfig {
        fun f(name: String) = File(dir, name).path
        return when (this) {
            KOKORO_INT8, KOKORO_FP32 -> OfflineTtsModelConfig(
                kokoro = OfflineTtsKokoroModelConfig(
                    model = f(if (this == KOKORO_INT8) "model.int8.onnx" else "model.onnx"),
                    voices = f("voices.bin"),
                    tokens = f("tokens.txt"),
                    dataDir = f("espeak-ng-data"),
                ),
                numThreads = threads,
                provider = provider,
            )
            SUPERTONIC3 -> OfflineTtsModelConfig(
                supertonic = OfflineTtsSupertonicModelConfig(
                    durationPredictor = f("duration_predictor.int8.onnx"),
                    textEncoder = f("text_encoder.int8.onnx"),
                    vectorEstimator = f("vector_estimator.int8.onnx"),
                    vocoder = f("vocoder.int8.onnx"),
                    ttsJson = f("tts.json"),
                    unicodeIndexer = f("unicode_indexer.bin"),
                    voiceStyle = f("voice.bin"),
                ),
                numThreads = threads,
                provider = provider,
            )
        }
    }
}

private fun tts(name: String) = "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/$name.tar.bz2"

/** One loaded TTS engine via sherpa-onnx. Serves all characters (voice = speaker id). */
class Voice(val engine: VoiceEngine, modelDir: File, threads: Int, provider: String = "cpu") {
    private val tts = OfflineTts(config = OfflineTtsConfig(model = engine.config(modelDir, threads, provider)))

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
