package dev.playground.companion

import android.content.Context
import android.os.SystemClock
import dev.playground.companion.engine.AudioOut
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
) {
    interface Listener {
        fun onStatus(text: String)
        fun onReplyText(turn: Int, piece: String)
        fun onTurnDone(turn: Int, report: String)
    }

    private val llmExec = Executors.newSingleThreadExecutor { Thread(it, "llm") }
    private val ttsQueue = LinkedBlockingQueue<TtsJob>()
    @Volatile private lateinit var voice: Voice
    @Volatile private lateinit var audio: AudioOut
    @Volatile var voiceEngine: VoiceEngine = initialVoice; private set
    private var robot: RobotFilter? = null

    @Volatile private var currentTurn = 0
    @Volatile var character: Character = CHARACTERS[0]; private set
    var loadReport = ""; private set

    private sealed class TtsJob(val turn: Int) {
        class Speak(turn: Int, val text: String, val trace: TurnTrace) : TtsJob(turn)
        class End(turn: Int, val trace: TurnTrace) : TtsJob(turn)
    }

    fun load(onReady: () -> Unit) = llmExec.execute {
        val memStart = MemProbe.read(ctx)
        ui.onStatus("Loading LLM…")
        var t = SystemClock.elapsedRealtime()
        NativeLlm.init(ctx.applicationInfo.nativeLibraryDir)
        check(NativeLlm.load(store.llmFile.path, N_CTX, LLM_THREADS)) { "LLM failed to load" }
        val llmMs = SystemClock.elapsedRealtime() - t

        ui.onStatus("Loading voice…")
        if (!store.voiceReady(voiceEngine)) voiceEngine = VoiceEngine.KOKORO_INT8
        t = SystemClock.elapsedRealtime()
        loadVoice(voiceEngine)
        val voiceMs = SystemClock.elapsedRealtime() - t
        Thread(::ttsLoop, "tts").apply { isDaemon = true; start() }

        applyCharacter(character)
        val mem = MemProbe.read(ctx)
        loadReport = buildString {
            appendLine("LOAD  llm ${llmMs} ms | voice ${voiceEngine.label} ${voiceMs} ms | ctx $N_CTX | threads llm $LLM_THREADS tts $TTS_THREADS")
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
        val v = Voice(e, store.voiceDir(e), TTS_THREADS)
        if (!::audio.isInitialized || audioRate != v.sampleRate) {
            if (::audio.isInitialized) audio.release()
            audio = AudioOut(v.sampleRate)
            audioRate = v.sampleRate
        }
        voice = v
        voiceEngine = e
        robot = if (character.robot) RobotFilter(v.sampleRate) else null
    }

    private var audioRate = 0

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

    fun select(c: Character) {
        stop()
        character = c
        llmExec.execute { applyCharacter(c) }
    }

    private fun applyCharacter(c: Character) {
        NativeLlm.setSystem(c.systemPrompt)
        robot = if (c.robot) RobotFilter(voice.sampleRate) else null
    }

    fun say(text: String): Int {
        stop()
        val turn = ++currentTurn
        val trace = TurnTrace(turn, "${character.name}, ${voiceEngine.label}", SystemClock.elapsedRealtime())
        llmExec.execute {
            if (turn != currentTurn) return@execute
            trace.memBefore = MemProbe.read(ctx)
            val chunker = SentenceChunker()
            fun emit(chunk: String) {
                if (trace.firstChunkAt == 0L) { trace.firstChunkAt = now(); trace.firstChunkText = chunk }
                ttsQueue.put(TtsJob.Speak(turn, chunk, trace))
            }
            val stats = NativeLlm.replyStreaming(text, MAX_REPLY_TOKENS) { bytes ->
                if (trace.firstPieceAt == 0L) trace.firstPieceAt = now()
                val piece = String(bytes, Charsets.UTF_8)
                ui.onReplyText(turn, piece)
                chunker.push(piece).forEach(::emit)
                turn == currentTurn
            }
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

    /** Stops generation and silences audio immediately. */
    fun stop() {
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
                        audio.enqueue(samples, onStart = {
                            if (job.trace.firstAudioAt == 0L) job.trace.firstAudioAt = now()
                        })
                    }
                }
                is TtsJob.End -> synchronized(voiceLock) { audio }.marker {
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
        const val TTS_THREADS = 4
        const val MAX_REPLY_TOKENS = 160
    }
}

class TurnTrace(val turn: Int, val who: String, val t0: Long) {
    class Chunk(val chars: Int, val synthMs: Long, val audioMs: Long)

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

    private fun rel(t: Long) = if (t == 0L) "—" else "${t - t0} ms"

    fun report(): String = buildString {
        val l = llm
        appendLine("TURN #$turn ($who)")
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
        val a = memAfter
        if (a != null) append("  RAM         : rss ${a.rssMb} MB, peak ${a.peakRssMb} MB | avail ${a.availMb}/${a.totalMb} MB${if (a.lowMemory) " LOW" else ""}")
    }
}
