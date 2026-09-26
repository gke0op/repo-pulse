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
class Pipeline(private val ctx: Context, private val store: ModelStore, private val ui: Listener) {
    interface Listener {
        fun onStatus(text: String)
        fun onReplyText(turn: Int, piece: String)
        fun onTurnDone(turn: Int, report: String)
    }

    private val llmExec = Executors.newSingleThreadExecutor { Thread(it, "llm") }
    private val ttsQueue = LinkedBlockingQueue<TtsJob>()
    private lateinit var voice: Voice
    private lateinit var audio: AudioOut
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
        t = SystemClock.elapsedRealtime()
        voice = Voice(store.voiceDir, TTS_THREADS)
        val voiceMs = SystemClock.elapsedRealtime() - t
        audio = AudioOut(voice.sampleRate)
        Thread(::ttsLoop, "tts").apply { isDaemon = true; start() }

        applyCharacter(character)
        val mem = MemProbe.read(ctx)
        loadReport = buildString {
            appendLine("LOAD  llm ${llmMs} ms | voice ${voiceMs} ms | ctx $N_CTX | threads llm $LLM_THREADS tts $TTS_THREADS")
            appendLine("RAM   before ${memStart.rssMb} MB -> after ${mem.rssMb} MB rss | avail ${mem.availMb}/${mem.totalMb} MB")
            append("CPU   ").append(NativeLlm.systemInfo().trim())
        }
        ui.onStatus("Ready")
        onReady()
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
        val trace = TurnTrace(turn, character.name, SystemClock.elapsedRealtime())
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
                    var samples = voice.synth(text, character.speakerId, character.speed)
                    robot?.let { samples = it.apply(samples) }
                    val synthMs = now() - t0
                    val audioMs = samples.size * 1000L / voice.sampleRate
                    job.trace.chunks += TurnTrace.Chunk(text.length, synthMs, audioMs)
                    if (job.turn != currentTurn) continue
                    audio.enqueue(samples, onStart = {
                        if (job.trace.firstAudioAt == 0L) job.trace.firstAudioAt = now()
                    })
                }
                is TtsJob.End -> audio.marker {
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
        const val TTS_THREADS = 2
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
