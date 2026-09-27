package dev.playground.companion

import android.content.Context
import android.os.SystemClock
import dev.playground.companion.engine.AudioOut
import dev.playground.companion.engine.EchoGuard
import dev.playground.companion.engine.Emotion
import dev.playground.companion.engine.EmotionTagStream
import dev.playground.companion.engine.Envelope
import dev.playground.companion.engine.LlmModel
import dev.playground.companion.engine.MemProbe
import dev.playground.companion.engine.NativeLlm
import dev.playground.companion.engine.RobotFilter
import dev.playground.companion.engine.SentenceChunker
import dev.playground.companion.engine.SpeechText
import dev.playground.companion.engine.Voice
import dev.playground.companion.engine.VoiceBench
import dev.playground.companion.engine.VoiceEngine
import java.util.concurrent.Executors
import java.util.concurrent.LinkedBlockingQueue

/**
 * The spine: text -> streaming LLM -> speakable chunks -> TTS -> audio, all overlapped.
 *
 *   llm thread : generates tokens, cuts chunks, queues them for TTS
 *   tts thread : synthesizes each chunk as soon as it arrives
 *   audio thread (AudioOut) : plays chunks back to back
 *
 * Every turn records a [TurnTrace] so we can see where the time goes on a real phone.
 */
class Pipeline(
    private val ctx: Context,
    private val store: ModelStore,
    private val ui: Listener,
    initialVoice: VoiceEngine,
    initialLlm: LlmModel,
) {
    interface Listener {
        fun onStatus(text: String)
        fun onReplyText(turn: Int, piece: String)
        fun onTurnDone(turn: Int, report: String)

        // Body language for the avatar (called from worker threads).
        /** A turn started: the character is working out a reply. */
        fun onThinking() {}
        /** An audio chunk starts playing now; [envelope] is its loudness per [frameMs]. */
        fun onSpeechChunk(envelope: FloatArray, frameMs: Int) {}
        /** The character was cut off mid-reply. */
        fun onInterrupted() {}
        /** The character's feeling, from the brain's emotion tags; timed to the speech it belongs to. */
        fun onEmotion(emotion: Emotion) {}
    }

    private val llmExec = Executors.newSingleThreadExecutor { Thread(it, "llm") }
    private val ttsQueue = LinkedBlockingQueue<TtsJob>()
    @Volatile private lateinit var voice: Voice
    @Volatile private lateinit var audio: AudioOut
    @Volatile var voiceEngine: VoiceEngine = initialVoice; private set
    @Volatile var llmModel: LlmModel = initialLlm; private set
    private var robot: RobotFilter? = null

    @Volatile private var currentTurn = 0
    @Volatile var character: Character = CHARACTERS[0]; private set
    var loadReport = ""; private set

    private sealed class TtsJob(val turn: Int) {
        class Speak(turn: Int, val text: String, val trace: TurnTrace, val emotion: Emotion?) : TtsJob(turn)
        class End(turn: Int, val trace: TurnTrace) : TtsJob(turn)
    }

    fun load(onReady: () -> Unit) = llmExec.execute {
        val memStart = MemProbe.read(ctx)
        ui.onStatus("Loading LLM…")
        if (!store.llmReady(llmModel)) llmModel = LlmModel.entries.first(store::llmReady)
        var t = SystemClock.elapsedRealtime()
        NativeLlm.init(ctx.applicationInfo.nativeLibraryDir)
        check(NativeLlm.load(store.llmFile(llmModel).path, N_CTX, LLM_THREADS)) { "LLM failed to load" }
        val llmMs = SystemClock.elapsedRealtime() - t

        ui.onStatus("Loading voice…")
        if (!store.voiceReady(voiceEngine)) voiceEngine = VoiceEngine.entries.first(store::voiceReady)
        t = SystemClock.elapsedRealtime()
        loadVoice(voiceEngine)
        val voiceMs = SystemClock.elapsedRealtime() - t
        Thread(::ttsLoop, "tts").apply { isDaemon = true; start() }

        applyCharacter(character)
        val mem = MemProbe.read(ctx)
        loadReport = buildString {
            appendLine("LOAD  llm ${llmModel.label} ${llmMs} ms | voice ${voiceEngine.label} ${voiceMs} ms | ctx $N_CTX | threads llm $LLM_THREADS tts ${voiceEngine.threads}")
            appendLine("RAM   before ${memStart.rssMb} MB -> after ${mem.rssMb} MB rss | avail ${mem.availMb}/${mem.totalMb} MB")
            append("CPU   ").append(NativeLlm.systemInfo().trim())
        }
        ui.onStatus("Ready")
        onReady()
    }

    /** Must run on the llm thread: nothing else touches the voice while it's swapped. */
    private fun loadVoice(e: VoiceEngine) = synchronized(voiceLock) {
        val old = if (::voice.isInitialized) voice else null
        old?.release()
        val v = Voice(e, store.voiceDir(e))
        // First synth pays ONNX Runtime's graph setup (~0.7 s measured); pay it now, not on the first reply.
        v.synth("Hi.", e.speakerFor(character.id), 1f)
        if (!::audio.isInitialized || audioRate != v.sampleRate) rebuildAudio(v.sampleRate)
        voice = v
        voiceEngine = e
        robot = if (character.robot) RobotFilter(v.sampleRate) else null
    }

    private var audioRate = 0
    @Volatile private var voiceCall = false

    private fun rebuildAudio(rate: Int) {
        if (::audio.isInitialized) audio.release()
        audio = AudioOut(rate, voiceCall)
        audioRate = rate
    }

    /**
     * Mic on => play through the voice-call path (with loudspeaker) so the echo canceller
     * can remove her voice from what the mic hears. Mic off => normal media playback.
     */
    fun setVoiceCallAudio(on: Boolean) {
        stop()
        llmExec.execute {
            synchronized(voiceLock) {
                voiceCall = on
                if (::voice.isInitialized) rebuildAudio(voice.sampleRate)
            }
        }
    }

    /** Held while synthesizing and while swapping engines, so a switch never frees a voice mid-synthesis. */
    private val voiceLock = Any()

    /** Downloads the engine if needed, then swaps it in between turns. */
    fun switchVoice(e: VoiceEngine, onDone: (String?) -> Unit) {
        stop()
        llmExec.execute {
            try {
                store.ensureVoice(e) { what, done, total ->
                    ui.onStatus(if (total > 0) "$what ${done * 100 / total}% (${done shr 20}/${total shr 20} MB)" else what)
                }
                ui.onStatus("Loading ${e.label}…")
                loadVoice(e)
                ui.onStatus("Ready")
                onDone(null)
            } catch (t: Throwable) {
                ui.onStatus("Voice switch failed: ${t.message}")
                onDone(t.message ?: "failed")
            }
        }
    }

    /** Downloads the brain if needed, then swaps it in (history restarts with the character prompt). */
    fun switchLlm(m: LlmModel, onDone: (String?) -> Unit) {
        stop()
        llmExec.execute {
            try {
                store.ensureLlm(m) { what, done, total ->
                    ui.onStatus(if (total > 0) "$what ${done * 100 / total}% (${done shr 20}/${total shr 20} MB)" else what)
                }
                ui.onStatus("Loading ${m.label}…")
                NativeLlm.unload()
                check(NativeLlm.load(store.llmFile(m).path, N_CTX, LLM_THREADS)) { "failed to load ${m.label}" }
                llmModel = m
                applyCharacter(character)
                ui.onStatus("Ready")
                onDone(null)
            } catch (t: Throwable) {
                // Fall back to whatever loads, so the app stays usable.
                runCatching { NativeLlm.load(store.llmFile(llmModel).path, N_CTX, LLM_THREADS); applyCharacter(character) }
                ui.onStatus("Brain switch failed: ${t.message}")
                onDone(t.message ?: "failed")
            }
        }
    }

    fun select(c: Character) {
        stop()
        character = c
        llmExec.execute { applyCharacter(c) }
    }

    private fun applyCharacter(c: Character) {
        NativeLlm.setSystem(c.systemPrompt)
        robot = if (c.robot) RobotFilter(voice.sampleRate) else null
    }

    /** True from a turn's start until its last audio has played. */
    val speaking: Boolean get() = activeTurn == currentTurn && activeTurn != 0
    @Volatile private var activeTurn = 0
    @Volatile private var speakingEndedAt = 0L
    @Volatile private var replySoFar = StringBuilder()

    /**
     * Barge-in: VAD hears speech while she talks. Three recognized words that aren't her own
     * echo are enough to cut her off; the rest of the utterance keeps flowing into ASR.
     */
    fun onUserSpeech(partial: String): Boolean {
        if (!speaking) return false
        // 3 words, not 2: EchoGuard can only judge 3+ words, and 2-word echoes of her own
        // voice were cutting her off (v0.6 on S24 Ultra).
        if (EchoGuard.words(partial).size < 3 || EchoGuard.isEcho(partial, replySoFar.toString())) return false
        stop()
        return true
    }

    sealed class Heard {
        class Turn(val id: Int) : Heard()
        class Ignored(val reason: String) : Heard()
    }

    /** A finished utterance from the mic: starts a turn, or says why it was ignored. */
    fun onUserUtterance(text: String, lastVoiceAt: Long, voicedMs: Int, recognizeMs: Long = 0): Heard {
        EchoGuard.rejectReason(text, voicedMs)?.let { return Heard.Ignored(it) }
        val recentlySpeaking = speaking || SystemClock.elapsedRealtime() - speakingEndedAt < ECHO_WINDOW_MS
        if (recentlySpeaking && EchoGuard.isEcho(text, replySoFar.toString())) return Heard.Ignored("her own echo")
        return Heard.Turn(say(text, heardAt = lastVoiceAt, recognizeMs = recognizeMs))
    }

    fun say(text: String, heardAt: Long = 0L, recognizeMs: Long = 0L): Int {
        stop()
        val turn = ++currentTurn
        activeTurn = turn
        replySoFar = StringBuilder()
        val trace = TurnTrace(turn, "${character.name}, ${llmModel.label}, ${voiceEngine.label}", SystemClock.elapsedRealtime())
        trace.heardAt = heardAt
        trace.recognizeMs = recognizeMs
        ui.onThinking()
        llmExec.execute {
            if (turn != currentTurn) return@execute
            trace.memBefore = MemProbe.read(ctx)
            val chunker = SentenceChunker()
            val tags = EmotionTagStream()
            var feeling: Emotion? = null
            fun emit(chunk: String) {
                if (trace.firstChunkAt == 0L) { trace.firstChunkAt = now(); trace.firstChunkText = chunk }
                ttsQueue.put(TtsJob.Speak(turn, chunk, trace, feeling))
            }
            fun spoken(text: String) {
                if (turn == currentTurn) replySoFar.append(text)
                ui.onReplyText(turn, text)
                chunker.push(text).forEach(::emit)
            }
            // Prefill "[" so every brain opens with an emotion tag (Llama 3.2 ignores the instruction otherwise).
            var prefilled = false
            val stats = NativeLlm.replyStreaming(text, MAX_REPLY_TOKENS, "[") { bytes ->
                // The first callback is our own prefilled "[", not a generated token.
                if (!prefilled) prefilled = true else if (trace.firstPieceAt == 0L) trace.firstPieceAt = now()
                for (part in tags.push(String(bytes, Charsets.UTF_8))) when (part) {
                    is EmotionTagStream.Part.Text -> spoken(part.text)
                    is EmotionTagStream.Part.Tag -> part.emotion?.let { e ->
                        // The first feeling shows at once (people react before they speak);
                        // later ones travel with their chunk and show when it plays.
                        if (trace.emotions.isEmpty()) ui.onEmotion(e)
                        trace.emotions += e
                        feeling = e
                    }
                }
                turn == currentTurn
            }
            tags.flush()?.let(::spoken)
            chunker.flush()?.let(::emit)
            trace.llm = stats
            trace.llmDoneAt = now()
            ttsQueue.put(TtsJob.End(turn, trace))
        }
        return turn
    }

    /** Runs the voice benchmark on the LLM thread so it never overlaps a turn. */
    fun benchVoice(onPartial: (String) -> Unit, onDone: (String) -> Unit) {
        stop()
        llmExec.execute {
            val engines = VoiceEngine.entries.filter(store::voiceReady).map { it to store.voiceDir(it) }
            val report = VoiceBench.run(engines, character.id) { status, partial ->
                ui.onStatus(status)
                onPartial(partial)
            }
            ui.onStatus("Ready")
            onDone(report)
        }
    }

    /** Runs the ASR bench on the LLM thread so it never overlaps a turn. */
    fun benchAsr(utterances: List<dev.playground.companion.engine.AsrBench.Utterance>, onPartial: (String) -> Unit, onDone: (String) -> Unit) {
        stop()
        llmExec.execute {
            val engines = dev.playground.companion.engine.AsrEngine.entries.filter(store::asr2Ready).map { it to store.asr2Dir(it) }
            val report = dev.playground.companion.engine.AsrBench.run(utterances, engines) { status, partial ->
                ui.onStatus(status)
                onPartial(partial)
            }
            ui.onStatus("Ready")
            onDone(report)
        }
    }

    /** Stops generation and silences audio immediately. */
    fun stop() {
        if (speaking) {
            speakingEndedAt = now()
            ui.onInterrupted()
        }
        activeTurn = 0
        currentTurn++
        NativeLlm.cancel()
        ttsQueue.clear()
        if (::audio.isInitialized) audio.flush()
    }

    private fun ttsLoop() {
        while (true) {
            val job = ttsQueue.take()
            if (job.turn != currentTurn) continue
            when (job) {
                is TtsJob.Speak -> {
                    val text = SpeechText.clean(job.text)
                    if (!SpeechText.speakable(text)) continue
                    val t0 = now()
                    synchronized(voiceLock) {
                        if (job.turn != currentTurn) return@synchronized
                        val v = voice
                        var samples = v.synth(text, v.engine.speakerFor(character.id), character.speed)
                        robot?.let { samples = it.apply(samples) }
                        val synthMs = now() - t0
                        val audioMs = samples.size * 1000L / v.sampleRate
                        job.trace.chunks += TurnTrace.Chunk(text.length, synthMs, audioMs)
                        if (job.turn != currentTurn) return@synchronized
                        val env = Envelope.of(samples, v.sampleRate, ENVELOPE_FRAME_MS)
                        audio.enqueue(samples, onStart = {
                            if (job.trace.firstAudioAt == 0L) job.trace.firstAudioAt = now()
                            if (job.turn == currentTurn) {
                                job.emotion?.let(ui::onEmotion)
                                ui.onSpeechChunk(env, ENVELOPE_FRAME_MS)
                            }
                        })
                    }
                }
                is TtsJob.End -> synchronized(voiceLock) { audio }.marker {
                    if (activeTurn == job.turn) { activeTurn = 0; speakingEndedAt = now() }
                    job.trace.doneAt = now()
                    job.trace.memAfter = MemProbe.read(ctx)
                    ui.onTurnDone(job.turn, job.trace.report())
                }
            }
        }
    }

    private fun now() = SystemClock.elapsedRealtime()

    companion object {
        const val N_CTX = 2048
        const val LLM_THREADS = 4
        const val MAX_REPLY_TOKENS = 160
        /** After she stops, mic text matching her words is still treated as echo for this long. */
        const val ECHO_WINDOW_MS = 3000L // echo tail + 0.8 s end-of-turn wait + decode
        const val ENVELOPE_FRAME_MS = 20
    }
}

class TurnTrace(val turn: Int, val who: String, val t0: Long) {
    class Chunk(val chars: Int, val synthMs: Long, val audioMs: Long)

    /** When VAD last heard the user (voice turns only). */
    @Volatile var heardAt = 0L
    /** Second-pass re-transcription time (voice turns with a second pass only). */
    @Volatile var recognizeMs = 0L
    @Volatile var firstPieceAt = 0L
    @Volatile var firstChunkAt = 0L
    @Volatile var firstChunkText = ""
    @Volatile var firstAudioAt = 0L
    @Volatile var llmDoneAt = 0L
    @Volatile var doneAt = 0L
    @Volatile var llm: NativeLlm.Stats? = null
    @Volatile var memBefore: MemProbe.Snapshot? = null
    @Volatile var memAfter: MemProbe.Snapshot? = null
    val chunks: MutableList<Chunk> = java.util.Collections.synchronizedList(mutableListOf())
    val emotions: MutableList<Emotion> = java.util.Collections.synchronizedList(mutableListOf())

    private fun rel(t: Long) = if (t == 0L) "—" else "${t - t0} ms"

    fun report(): String = buildString {
        val l = llm
        appendLine("TURN #$turn ($who)${if (heardAt > 0) " [voice]" else ""}")
        if (heardAt > 0 && firstAudioAt > 0) {
            appendLine("  you stopped -> her voice : ${firstAudioAt - heardAt} ms   <- from your last sound (incl. end-of-turn wait)")
            if (recognizeMs > 0) appendLine("  2nd-pass recognize      : $recognizeMs ms (included above)")
        }
        appendLine("  first audio : ${rel(firstAudioAt)}   <- time until you hear a voice")
        append("  first token : ${rel(firstPieceAt)}")
        if (l != null) append("  (prefill ${l.promptTokens} tok in ${"%.0f".format(l.prefillMs)} ms)")
        appendLine()
        appendLine("  first chunk : ${rel(firstChunkAt)}  \"${firstChunkText.take(40)}\"")
        if (l != null) {
            appendLine("  LLM         : ${l.genTokens} tok @ ${"%.1f".format(l.tokPerSec)} tok/s, done ${rel(llmDoneAt)}" +
                (if (l.rebuilt) " [history trimmed]" else "") + (if (l.cancelled) " [cancelled]" else ""))
        }
        val synth = chunks.sumOf { it.synthMs }
        val audio = chunks.sumOf { it.audioMs }
        val first = chunks.firstOrNull()
        appendLine("  TTS         : ${chunks.size} chunks, synth ${synth} ms for ${audio} ms audio" +
            (if (audio > 0) " (RTF ${"%.2f".format(synth.toDouble() / audio)})" else "") +
            (if (first != null) ", first chunk synth ${first.synthMs} ms" else ""))
        appendLine("  total       : ${rel(doneAt)}")
        if (emotions.isNotEmpty()) appendLine("  feeling     : ${emotions.joinToString(" -> ") { it.tag }}")
        val a = memAfter
        if (a != null) append("  RAM         : rss ${a.rssMb} MB, peak ${a.peakRssMb} MB | avail ${a.availMb}/${a.totalMb} MB${if (a.lowMemory) " LOW" else ""}")
    }
}
