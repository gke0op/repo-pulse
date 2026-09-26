package dev.playground.companion.engine

import android.annotation.SuppressLint
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.media.audiofx.AcousticEchoCanceler
import android.media.audiofx.NoiseSuppressor
import android.os.SystemClock
import com.k2fsa.sherpa.onnx.EndpointConfig
import com.k2fsa.sherpa.onnx.EndpointRule
import com.k2fsa.sherpa.onnx.OnlineModelConfig
import com.k2fsa.sherpa.onnx.OnlineRecognizer
import com.k2fsa.sherpa.onnx.OnlineRecognizerConfig
import com.k2fsa.sherpa.onnx.OnlineTransducerModelConfig
import com.k2fsa.sherpa.onnx.SileroVadModelConfig
import com.k2fsa.sherpa.onnx.Vad
import com.k2fsa.sherpa.onnx.VadModelConfig
import java.io.File

/**
 * Always-on listening, two passes:
 *  1. streaming Zipformer ASR: live partials while you talk + end-of-turn detection,
 *     with Silero VAD (is someone speaking right now?) for barge-in;
 *  2. when the utterance ends, a stronger offline model ([secondPass]) re-transcribes
 *     the whole utterance audio; that text is what the companion answers.
 *
 * Uses the VOICE_COMMUNICATION source so the platform echo canceller can subtract
 * the companion's own voice from the mic signal.
 */
class Ears(asrDir: File, vadFile: File, private val listener: Listener) {
    interface Listener {
        /** Text so far for the current utterance (updates while you talk). */
        fun onPartial(text: String)
        /**
         * The utterance ended (trailing silence). [lastVoiceAt] is when VAD last heard speech;
         * [voicedMs] is how much of the utterance VAD judged to be speech.
         */
        fun onFinal(text: String, lastVoiceAt: Long, voicedMs: Int, recognizeMs: Long)
        /** VAD sees speech right now: the hook for barge-in. */
        fun onSpeechActivity(partial: String)
    }

    private val recognizer = OnlineRecognizer(
        config = OnlineRecognizerConfig(
            modelConfig = OnlineModelConfig(
                transducer = OnlineTransducerModelConfig(
                    encoder = File(asrDir, "encoder-epoch-99-avg-1-chunk-16-left-128.int8.onnx").path,
                    decoder = File(asrDir, "decoder-epoch-99-avg-1-chunk-16-left-128.int8.onnx").path,
                    joiner = File(asrDir, "joiner-epoch-99-avg-1-chunk-16-left-128.int8.onnx").path,
                ),
                tokens = File(asrDir, "tokens.txt").path,
                numThreads = 2,
            ),
            // Conversation, not dictation: end the turn after 0.8 s of silence (default 1.4 s).
            endpointConfig = EndpointConfig(
                rule1 = EndpointRule(false, 2.4f, 0.0f),
                rule2 = EndpointRule(true, 0.8f, 0.0f),
                rule3 = EndpointRule(false, 0.0f, 20.0f),
            ),
            enableEndpoint = true,
            // Beam search fixed name slips greedy made on desktop tests ("murra" -> "mira").
            decodingMethod = "modified_beam_search",
            maxActivePaths = 4,
        ),
    )

    private val vad = Vad(
        config = VadModelConfig(
            sileroVadModelConfig = SileroVadModelConfig(
                model = vadFile.path,
                threshold = 0.5f,
                minSilenceDuration = 0.25f,
                minSpeechDuration = 0.15f,
                windowSize = 512,
            ),
            sampleRate = SAMPLE_RATE,
            numThreads = 1,
        ),
    )

    @Volatile private var running = false
    @Volatile private var discard = false

    /** Offline re-transcriber; null = use the streaming text as-is. */
    @Volatile var secondPass: Transcriber? = null
    private val secondPassExec = java.util.concurrent.Executors.newSingleThreadExecutor { Thread(it, "ears-2nd") }

    /** Your last few utterances (audio + texts), for the on-device ASR bench. */
    val recent: MutableList<AsrBench.Utterance> = java.util.Collections.synchronizedList(mutableListOf())

    /** Drop whatever is buffered for the current utterance (e.g. her echo tail after she stops). */
    fun discardUtterance() { discard = true }
    private var thread: Thread? = null
    var echoCancel: Boolean = false; private set

    @SuppressLint("MissingPermission") // caller checks RECORD_AUDIO
    fun start() {
        if (running) return
        running = true
        thread = Thread(::loop, "ears").apply { isDaemon = true; start() }
    }

    fun stop() {
        running = false
        thread?.join(1000)
        thread = null
    }

    fun release() {
        stop()
        secondPassExec.shutdown()
        secondPassExec.awaitTermination(2, java.util.concurrent.TimeUnit.SECONDS)
        secondPass?.release()
        recognizer.release()
        vad.release()
    }

    @SuppressLint("MissingPermission")
    private fun loop() {
        val minBuf = AudioRecord.getMinBufferSize(SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
        val rec = AudioRecord(
            MediaRecorder.AudioSource.VOICE_COMMUNICATION, SAMPLE_RATE,
            AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, maxOf(minBuf, CHUNK * 2 * 20),
        )
        val aec = if (AcousticEchoCanceler.isAvailable()) AcousticEchoCanceler.create(rec.audioSessionId)?.apply { enabled = true } else null
        val ns = if (NoiseSuppressor.isAvailable()) NoiseSuppressor.create(rec.audioSessionId)?.apply { enabled = true } else null
        echoCancel = aec?.enabled == true

        val stream = recognizer.createStream()
        val pcm = ShortArray(CHUNK)
        var lastText = ""
        var lastChangeAt = 0L
        var lastVoiceAt = 0L
        var voicedMs = 0
        // Audio of the current utterance, in 100 ms chunks; firstVoiced marks where speech began.
        val utterance = ArrayList<FloatArray>()
        var firstVoiced = -1
        try {
            rec.startRecording()
            while (running) {
                val n = rec.read(pcm, 0, pcm.size)
                if (n <= 0) continue
                val samples = FloatArray(n) { pcm[it] / 32768f }
                if (utterance.size < MAX_UTTERANCE_CHUNKS) utterance += samples

                if (discard) {
                    discard = false
                    recognizer.reset(stream)
                    lastText = ""
                    voicedMs = 0
                    utterance.clear()
                    firstVoiced = -1
                    listener.onPartial("")
                }

                vad.acceptWaveform(samples)
                while (!vad.empty()) vad.pop() // we only need the live speech flag, not segments

                stream.acceptWaveform(samples, SAMPLE_RATE)
                while (recognizer.isReady(stream)) recognizer.decode(stream)
                val text = sentenceCase(recognizer.getResult(stream).text)
                if (text != lastText) {
                    lastText = text
                    lastChangeAt = SystemClock.elapsedRealtime()
                    listener.onPartial(text)
                }
                if (vad.isSpeechDetected()) {
                    if (firstVoiced < 0) firstVoiced = utterance.size - 1
                    lastVoiceAt = SystemClock.elapsedRealtime()
                    voicedMs += n * 1000 / SAMPLE_RATE
                    listener.onSpeechActivity(text)
                }

                if (recognizer.isEndpoint(stream)) {
                    // VAD's last speech is closer to when you actually stopped than ASR's last text
                    // change (measured ~0.7 s ASR lag); fall back to the latter if VAD never fired.
                    if (text.isNotEmpty()) {
                        val heardAt = if (lastVoiceAt > 0) lastVoiceAt else lastChangeAt
                        // Start ~0.5 s before VAD fired: VAD needs a little speech before it triggers.
                        val from = if (firstVoiced < 0) 0 else maxOf(0, firstVoiced - PRE_ROLL_CHUNKS)
                        finish(text, concat(utterance, from), heardAt, voicedMs)
                    }
                    recognizer.reset(stream)
                    lastText = ""
                    voicedMs = 0
                    utterance.clear()
                    firstVoiced = -1
                    listener.onPartial("")
                }
            }
        } finally {
            rec.stop()
            rec.release()
            aec?.release()
            ns?.release()
            stream.release()
        }
    }

    /** Runs the second pass off the mic thread, so recording never stalls. */
    private fun finish(streamingText: String, audio: FloatArray, heardAt: Long, voicedMs: Int) {
        secondPassExec.execute {
            val sp = secondPass
            val r = if (sp == null) null else runCatching { sp.transcribe(audio) }.getOrNull()
            val text = r?.text?.takeIf { it.isNotBlank() } ?: streamingText
            recent += AsrBench.Utterance(audio, streamingText, text)
            while (recent.size > KEEP_RECENT) recent.removeAt(0)
            listener.onFinal(text, heardAt, voicedMs, r?.ms ?: 0L)
        }
    }

    private fun concat(chunks: List<FloatArray>, from: Int): FloatArray {
        val out = FloatArray(chunks.drop(from).sumOf { it.size })
        var o = 0
        for (i in from until chunks.size) { chunks[i].copyInto(out, o); o += chunks[i].size }
        return out
    }

    companion object {
        const val PRE_ROLL_CHUNKS = 5          // 0.5 s
        const val MAX_UTTERANCE_CHUNKS = 300   // 30 s
        const val KEEP_RECENT = 5

        /** The model emits ALL CAPS; the LLM reads that as shouting. */
        fun sentenceCase(raw: String): String {
            val t = raw.trim().lowercase().replace(Regex("\\bi\\b"), "I")
            return t.replaceFirstChar { it.uppercaseChar() }
        }

        const val SAMPLE_RATE = 16000
        const val CHUNK = SAMPLE_RATE / 10 // 100 ms
    }
}
