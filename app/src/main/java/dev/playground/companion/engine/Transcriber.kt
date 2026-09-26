package dev.playground.companion.engine

import android.os.SystemClock
import com.k2fsa.sherpa.onnx.FeatureConfig
import com.k2fsa.sherpa.onnx.OfflineCanaryModelConfig
import com.k2fsa.sherpa.onnx.OfflineModelConfig
import com.k2fsa.sherpa.onnx.OfflineRecognizer
import com.k2fsa.sherpa.onnx.OfflineRecognizerConfig
import com.k2fsa.sherpa.onnx.OfflineTransducerModelConfig
import java.io.File

/**
 * Second-pass recognizers: once an utterance ends, re-transcribe the whole thing with a
 * stronger offline model. Desktop race on phone-degraded speech (call band + background
 * talker + noise): streaming Zipformer 29% WER, Canary 180M 4.5%, Parakeet 0.6B 0%.
 */
enum class AsrEngine(val label: String, val dirName: String, val approxMb: Int, val featureDim: Int) {
    PARAKEET("Parakeet 0.6B", "sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8", 482, 80),
    CANARY("Canary 180M", "sherpa-onnx-nemo-canary-180m-flash-en-es-de-fr-int8", 154, 128);

    val url get() = "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/$dirName.tar.bz2"

    fun config(dir: File, threads: Int): OfflineModelConfig {
        fun f(name: String) = File(dir, name).path
        return when (this) {
            PARAKEET -> OfflineModelConfig(
                transducer = OfflineTransducerModelConfig(
                    encoder = f("encoder.int8.onnx"),
                    decoder = f("decoder.int8.onnx"),
                    joiner = f("joiner.int8.onnx"),
                ),
                tokens = f("tokens.txt"),
                modelType = "nemo_transducer",
                numThreads = threads,
            )
            CANARY -> OfflineModelConfig(
                canary = OfflineCanaryModelConfig(
                    encoder = f("encoder.int8.onnx"),
                    decoder = f("decoder.int8.onnx"),
                    srcLang = "en",
                    tgtLang = "en",
                ),
                tokens = f("tokens.txt"),
                numThreads = threads,
            )
        }
    }
}

class Transcriber(val engine: AsrEngine, dir: File, threads: Int = 2) {
    // Feature dims match the settings the desktop race scored with (sherpa's Python defaults).
    private val recognizer = OfflineRecognizer(
        config = OfflineRecognizerConfig(
            featConfig = FeatureConfig(sampleRate = Ears.SAMPLE_RATE, featureDim = engine.featureDim),
            modelConfig = engine.config(dir, threads),
        ),
    )

    class Result(val text: String, val ms: Long)

    fun transcribe(samples: FloatArray, sampleRate: Int = Ears.SAMPLE_RATE): Result {
        val t0 = SystemClock.elapsedRealtime()
        val stream = recognizer.createStream()
        try {
            stream.acceptWaveform(samples, sampleRate)
            recognizer.decode(stream)
            return Result(recognizer.getResult(stream).text.trim(), SystemClock.elapsedRealtime() - t0)
        } finally {
            stream.release()
        }
    }

    fun release() = recognizer.release()
}

/** Re-runs every downloaded second-pass engine on your recent real utterances. */
object AsrBench {
    class Utterance(val audio: FloatArray, val firstPass: String, val used: String)

    fun run(utterances: List<Utterance>, engines: List<Pair<AsrEngine, File>>, progress: (String, String) -> Unit): String = buildString {
        appendLine("ASR BENCH on your last ${utterances.size} utterance(s)")
        if (utterances.isEmpty()) { appendLine("  (say a few things with the mic on first)"); return@buildString }
        val loaded = engines.mapNotNull { (e, dir) ->
            progress("Loading ${e.label}…", toString())
            runCatching { Transcriber(e, dir) }.getOrNull()
        }
        try {
            utterances.forEachIndexed { i, u ->
                val secs = u.audio.size.toFloat() / Ears.SAMPLE_RATE
                appendLine("#${i + 1} (%.1f s)".format(secs))
                appendLine("  streaming : ${u.firstPass}")
                for (t in loaded) {
                    progress("Transcribing #${i + 1} with ${t.engine.label}…", toString())
                    val r = t.transcribe(u.audio)
                    appendLine("  %-10s: %s  [%d ms]".format(t.engine.label.substringBefore(' '), r.text, r.ms))
                }
            }
        } finally {
            loaded.forEach { it.release() }
        }
        progress("ASR bench done", toString())
    }.trimEnd()
}
