package dev.playground.companion

import android.content.Context
import android.os.PowerManager
import android.os.SystemClock
import dev.playground.companion.engine.AudioOut
import dev.playground.companion.engine.EchoGuard
import dev.playground.companion.engine.Emotion
import dev.playground.companion.engine.EmotionTagStream
import dev.playground.companion.engine.Envelope
import dev.playground.companion.engine.LlmModel
import dev.playground.companion.engine.Memory
import dev.playground.companion.engine.MemoryStore
import dev.playground.companion.engine.MemProbe
import dev.playground.companion.engine.NativeLlm
import dev.playground.companion.engine.ReplyLength
import dev.playground.companion.engine.RobotFilter
import dev.playground.companion.engine.SelfReport
import dev.playground.companion.engine.TurnDetector
import dev.playground.companion.engine.SentenceChunker
import dev.playground.companion.engine.SpeechText
import dev.playground.companion.engine.Voice
import dev.playground.companion.engine.VoiceBench
import dev.playground.companion.engine.VoiceEngine
import java.util.concurrent.CountDownLatch
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
        /** The full reply text is known (even if playback is later cut off). */
        fun onReplyComplete(trace: TurnTrace) {}
        /** Waking up at launch: 0 asleep .. 1 awake, as each piece is ready (called from worker threads). */
        fun onWake(level: Float) {}
    }

    private val llmExec = Executors.newSingleThreadExecutor { Thread(it, "llm") }
    private val ttsQueue = LinkedBlockingQueue<TtsJob>()
    @Volatile private lateinit var voice: Voice
    @Volatile private lateinit var audio: AudioOut
    @Volatile var voiceEngine: VoiceEngine = initialVoice; private set
    @Volatile var llmModel: LlmModel = initialLlm; private set
    private var robot: RobotFilter? = null

    @Volatile private var currentTurn = 0
    /** currentTurn is bumped from the UI, ears and ears-2nd threads; a lost update would strand a turn. */
    private val turnLock = Any()
    @Volatile var character: Character = CHARACTERS[0]; private set
    var loadReport = ""; private set

    private sealed class TtsJob(val turn: Int) {
        class Speak(turn: Int, val text: String, val trace: TurnTrace, val emotion: Emotion?, val first: Boolean = false) : TtsJob(turn)
        class End(turn: Int, val trace: TurnTrace) : TtsJob(turn)
    }

    fun load(onReady: () -> Unit) = llmExec.execute {
        val memStart = MemProbe.read(ctx)
        ui.onStatus("Waking ${character.name}…")
        ui.onWake(0.1f)
        if (!store.llmReady(llmModel)) llmModel = LlmModel.entries.first(store::llmReady)
        if (!store.voiceReady(voiceEngine)) voiceEngine = VoiceEngine.entries.first(store::voiceReady)
        // Brain and voice load side by side (they were one after the other: ~5 s + ~1.6 s).
        val t0 = SystemClock.elapsedRealtime()
        var voiceMs = 0L
        var voiceError: Throwable? = null
        val voiceThread = Thread({
            try { loadVoice(voiceEngine) } catch (t: Throwable) { voiceError = t }
            voiceMs = SystemClock.elapsedRealtime() - t0
            ui.onWake(0.4f)
        }, "voice-load").apply { start() }
        NativeLlm.init(ctx.applicationInfo.nativeLibraryDir)
        check(NativeLlm.load(store.llmFile(llmModel).path, N_CTX, LLM_THREADS, LLM_BATCH_THREADS)) { "LLM failed to load" }
        val llmMs = SystemClock.elapsedRealtime() - t0
        ui.onWake(0.6f)
        voiceThread.join()
        voiceError?.let { throw it }
        Thread(::ttsLoop, "tts").apply { isDaemon = true; start() }

        dropStaleKvCaches()
        applyCharacter(character)
        val (primeMs, cached) = NativeLlm.lastPrime().let { it[0].toLong() to (it[1] > 0) }
        woke = if (character.id == SelfReport.CHARACTER_ID) (SystemClock.elapsedRealtime() - t0) to cached else null
        val mem = MemProbe.read(ctx)
        loadReport = buildString {
            appendLine("LOAD  llm ${llmModel.label} ${llmMs} ms | voice ${voiceEngine.label} ${voiceMs} ms (side by side) | ${character.name}'s prompt ${primeMs} ms (${if (cached) "from cache" else "read, now cached"}) | ctx $N_CTX | threads llm $LLM_THREADS/$LLM_BATCH_THREADS tts ${voiceEngine.threads}")
            appendLine("RAM   before ${memStart.rssMb} MB -> after ${mem.rssMb} MB rss | avail ${mem.availMb}/${mem.totalMb} MB")
            append("CPU   ").append(NativeLlm.systemInfo().trim())
        }
        ui.onStatus("Ready")
        ui.onWake(1f)
        onReady()
        // Then, while nobody talks, get the others ready (queued behind anything you say first).
        val since = stops
        val gen0 = NativeLlm.cancelGen()
        llmExec.execute { primeStaleCaches(since, gen0) }
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
                check(NativeLlm.load(store.llmFile(m).path, N_CTX, LLM_THREADS, LLM_BATCH_THREADS)) { "failed to load ${m.label}" }
                llmModel = m
                dropStaleKvCaches()
                applyCharacter(character)
                ui.onStatus("Ready")
                onDone(null)
                val since = stops
                val gen0 = NativeLlm.cancelGen()
                llmExec.execute { primeStaleCaches(since, gen0) }
            } catch (t: Throwable) {
                // Fall back to whatever loads, so the app stays usable.
                runCatching { NativeLlm.load(store.llmFile(llmModel).path, N_CTX, LLM_THREADS, LLM_BATCH_THREADS); applyCharacter(character) }
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

    /** Before load(): who to wake up as (the one you last talked to). */
    fun restore(c: Character) { character = c }

    private fun systemPrompt(c: Character): String {
        val self = if (SelfReport.ENABLED && c.id == SelfReport.CHARACTER_ID)
            SelfReport.harness(llmModel.label, voiceEngine.label, CHARACTERS.filter { it.id != c.id }.map { it.name }) else ""
        return c.systemPrompt(Memory.promptBlock(memory.notes(c.id)), self)
    }

    /**
     * The primed system prompt, saved per brain, context size and character. Reading the prompt
     * took ~18 s at every launch (phone 2026-09-29: 30 s to the first word); loading this doesn't.
     * The engine only uses it when it holds exactly the current prompt's tokens.
     */
    private fun kvCache(c: Character): java.io.File =
        java.io.File(ctx.filesDir, "kv").apply { mkdirs() }.resolve("${kvPrefix()}${c.id}.kv")
    /** Brain file, its size (a replaced file under the same name must not load old state) and n_ctx. */
    private fun kvPrefix() = "${llmModel.fileName}.${store.llmFile(llmModel).length()}.$N_CTX."

    /** Other brains' and context sizes' caches: ~15-150 MB each, useless now. */
    private fun dropStaleKvCaches() {
        java.io.File(ctx.filesDir, "kv").listFiles()?.filter { !it.name.startsWith(kvPrefix()) }?.forEach { it.delete() }
    }

    /** Which prompt a cache file holds, so a stale one is re-primed without reading it (the engine checks tokens too). */
    private fun cacheKey(prompt: String) = "${prompt.length}:${prompt.hashCode()}"
    private fun cacheFresh(c: Character, prompt: String): Boolean {
        val f = kvCache(c); val key = java.io.File(f.path + ".key")
        return f.exists() && key.exists() && key.readText() == cacheKey(prompt)
    }

    private fun applyCharacter(c: Character) {
        selfTracker.reset()
        val prompt = systemPrompt(c)
        // The key only when the file really holds this prompt, and never fatally (disk full: review 2026-09-29).
        if (NativeLlm.setSystem(prompt, kvCache(c).path) && NativeLlm.lastPrime()[2] > 0)
            runCatching { java.io.File(kvCache(c).path + ".key").writeText(cacheKey(prompt)) }
        robot = if (c.robot) RobotFilter(voice.sampleRate) else null
    }

    /**
     * Primes every character whose cache is missing or stale (a scratch context; the live
     * conversation is untouched), the one you talk to first. Each takes ~13-40 s on the phone, so
     * without this the first wake-up or switch to Kai or Seven read his prompt (2026-09-29). Any
     * stop() (you spoke) cancels it; the rest waits for the next idle moment. Runs on the llm thread.
     */
    private fun primeStaleCaches(since: Int, gen0: Long, report: MutableList<String>? = null) {
        for (c in CHARACTERS.sortedBy { if (it == character) 0 else 1 }) {
            if (stops != since) return
            val prompt = systemPrompt(c)
            if (cacheFresh(c, prompt)) continue
            val t0 = SystemClock.elapsedRealtime()
            if (NativeLlm.primeCache(prompt, kvCache(c).path, gen0) && stops == since) {
                runCatching { java.io.File(kvCache(c).path + ".key").writeText(cacheKey(prompt)) }
                report?.add("${c.name}: ready for next time (${(SystemClock.elapsedRealtime() - t0) / 1000} s)")
            }
        }
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
        // You kept talking after a short pause: drop the early start quietly (nothing was heard).
        if (heldTurn != 0) { stop(); return false }
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
        // The early start from your last short pause heard exactly this (and passed the echo check then): let it speak.
        if (commit(text)) return Heard.Turn(activeTurn)
        val recentlySpeaking = speaking || SystemClock.elapsedRealtime() - speakingEndedAt < ECHO_WINDOW_MS
        if (recentlySpeaking && EchoGuard.isEcho(text, replySoFar.toString())) return Heard.Ignored("her own echo")
        return Heard.Turn(say(text, heardAt = lastVoiceAt, recognizeMs = recognizeMs))
    }

    /**
     * FTT: a short pause in your speech starts the reply early, held silent. The brain and the
     * voice work while the end-of-turn wait runs out; [onUserUtterance] then commits it (same
     * text) or it is cancelled when you speak again.
     */
    fun onUserPause(text: String, lastVoiceAt: Long, voicedMs: Int, recognizeMs: Long) {
        if (EchoGuard.rejectReason(text, voicedMs) != null) return
        if (speaking && heldTurn == 0) return // she's talking: that's barge-in's business
        if (SystemClock.elapsedRealtime() - speakingEndedAt < ECHO_WINDOW_MS && EchoGuard.isEcho(text, replySoFar.toString())) return
        if (heldTurn != 0 && heldText == text) return
        earlyStarted++
        say(text, heardAt = lastVoiceAt, recognizeMs = recognizeMs, held = true)
    }

    /** Smart Turn's score for the pause that started the current early start (for the turn report). */
    fun onPauseScored(lastVoiceAt: Long, turnProb: Float) {
        activeTrace?.takeIf { it.early && it.heardAt == lastVoiceAt }?.turnProb = turnProb
    }

    // Early-start state. holdLock guards heldTurn and the UI callbacks deferred until commit.
    private val holdLock = Any()
    @Volatile private var heldTurn = 0
    @Volatile private var heldText = ""
    @Volatile private var holdGate = CountDownLatch(0)
    private var heldTrace: TurnTrace? = null
    private val deferred = mutableListOf<() -> Unit>()
    @Volatile private var activeTrace: TurnTrace? = null
    private var earlyStarted = 0
    private var earlyCommitted = 0

    /** Runs [action] now, or at commit if [trace]'s turn is still held; drops it for a cancelled early start. */
    private fun liveOrDefer(trace: TurnTrace, action: () -> Unit) {
        synchronized(holdLock) {
            when {
                trace.turn == heldTurn -> { deferred += action; return }
                trace.early && !trace.committed -> return
            }
        }
        action()
    }

    private fun commit(text: String): Boolean {
        val actions: List<() -> Unit>
        synchronized(holdLock) {
            val t = heldTrace
            if (heldTurn == 0 || heldTurn != activeTurn || heldText != text || t == null) return false
            heldTurn = 0
            t.committed = true
            t.committedAt = now()
            earlyCommitted++
            t.earlyTally = "$earlyCommitted of $earlyStarted early starts used"
            actions = deferred.toList()
            deferred.clear()
        }
        actions.forEach { it() }
        holdGate.countDown()
        return true
    }

    fun say(text: String, heardAt: Long = 0L, recognizeMs: Long = 0L, held: Boolean = false): Int {
        stop()
        val turn = synchronized(turnLock) { ++currentTurn }
        activeTurn = turn
        replySoFar = StringBuilder()
        val trace = TurnTrace(turn, "${character.name}, ${llmModel.label}, ${voiceEngine.label}", SystemClock.elapsedRealtime())
        trace.character = character.name
        trace.characterId = character.id
        trace.userText = text
        trace.heardAt = heardAt
        trace.recognizeMs = recognizeMs
        trace.early = held
        if (SelfReport.ENABLED && character.id == SelfReport.CHARACTER_ID) trace.readings = selfTracker.line(selfSnapshot())
        activeTrace = trace
        if (held) synchronized(holdLock) {
            holdGate = CountDownLatch(1)
            heldText = text
            heldTrace = trace
            heldTurn = turn
        }
        liveOrDefer(trace) { ui.onThinking() }
        llmExec.execute {
            if (turn != currentTurn) return@execute
            trace.memBefore = MemProbe.read(ctx)
            val chunker = SentenceChunker()
            val tags = EmotionTagStream()
            var feeling: Emotion? = null
            fun emit(chunk: String) {
                val first = trace.firstChunkAt == 0L
                if (first) { trace.firstChunkAt = now(); trace.firstChunkText = chunk }
                // Voice first: the brain waits while the first chunk synthesizes (released in ttsLoop).
                // Only while the phone is cool: hot, the brain is already behind the voice (tonight,
                // status 3: 1.8 s median silence inside replies) and pausing it would widen the gaps.
                if (first && VOICE_FIRST && heatLevel == "cool") { trace.voiceFirst = true; NativeLlm.hold(true) }
                ttsQueue.put(TtsJob.Speak(turn, chunk, trace, feeling, first))
            }
            fun spoken(text: String) {
                if (turn == currentTurn) replySoFar.append(text)
                ui.onReplyText(turn, text)
                chunker.push(text).forEach(::emit)
            }
            // Prefill "[" so every brain opens with an emotion tag (Llama 3.2 ignores the instruction otherwise).
            var prefilled = false
            val stats = NativeLlm.replyStreaming(ReplyLength.framed(text + (trace.readings ?: "")), MAX_REPLY_TOKENS, "[") { bytes ->
                // The first callback is our own prefilled "[", not a generated token.
                if (!prefilled) prefilled = true else if (trace.firstPieceAt == 0L) trace.firstPieceAt = now()
                for (part in tags.push(String(bytes, Charsets.UTF_8))) when (part) {
                    is EmotionTagStream.Part.Text -> spoken(part.text)
                    is EmotionTagStream.Part.Tag -> part.emotion?.let { e ->
                        // The first feeling shows at once (people react before they speak);
                        // later ones travel with their chunk and show when it plays.
                        if (trace.emotions.isEmpty()) liveOrDefer(trace) { ui.onEmotion(e) }
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
            trace.replyText = replySoFar.toString().trim()
            liveOrDefer(trace) { ui.onReplyComplete(trace) }
            ttsQueue.put(TtsJob.End(turn, trace))
        }
        return turn
    }

    // ---- Unit Seven's readings (SelfReport) ------------------------------------------------
    private val selfTracker = SelfReport.Tracker()
    /** How long Unit Seven took to wake up at app start, and whether his prompt came from the cache. */
    @Volatile private var woke: Pair<Long, Boolean>? = null
    @Volatile private var lastHeard: TurnTrace? = null

    private fun selfSnapshot(): SelfReport.Snapshot {
        val now = System.currentTimeMillis()
        val (status, _) = heatReading()
        // Sticky broadcast: no receiver needed, just the latest battery state.
        val battery = runCatching { ctx.registerReceiver(null, android.content.IntentFilter(android.content.Intent.ACTION_BATTERY_CHANGED)) }.getOrNull()
        val last = lastHeard?.takeIf { it.characterId == SelfReport.CHARACTER_ID }
        val notes = memory.notes(SelfReport.CHARACTER_ID)
        return SelfReport.Snapshot(
            // Words, not the status number: "thermal status 0" was read back as "0 degrees" (host probes).
            heat = "$heatLevel, " + (if (status >= 2) "the phone is slowing itself down" else "no slowdown") +
                "; your body drawn at up to ${if (heatLevel == "hot") 24 else if (heatLevel == "warm") 30 else 60} fps",
            tokPerSec = last?.llm?.tokPerSec,
            ramMb = MemProbe.read(ctx).rssMb.toInt(),
            batteryPct = battery?.let { b -> b.getIntExtra(android.os.BatteryManager.EXTRA_LEVEL, -1).takeIf { it >= 0 }?.let { it * 100 / b.getIntExtra(android.os.BatteryManager.EXTRA_SCALE, 100).coerceAtLeast(1) } },
            batteryC = battery?.getIntExtra(android.os.BatteryManager.EXTRA_TEMPERATURE, Int.MIN_VALUE)?.takeIf { it != Int.MIN_VALUE }?.let { it / 10.0 },
            trimmed = last?.llm?.rebuilt == true,
            sinceLastTalkMs = memory.lastTalked(SelfReport.CHARACTER_ID)?.let { now - it },
            others = CHARACTERS.filter { it.id != SelfReport.CHARACTER_ID }.map { c -> c.name to memory.lastTalked(c.id)?.let { now - it } },
            notes = notes.size,
            wishes = notes.count { it.tag == Memory.Tag.WISH },
            wokeInMs = woke?.first,
            promptFromCache = woke?.second == true,
        )
    }

    // ---- long-term memory -----------------------------------------------------------------
    private val memory = MemoryStore(java.io.File(ctx.getExternalFilesDir(null) ?: ctx.filesDir, "memory"))
    private val distillTemplate by lazy { ctx.assets.open("memory/distill.txt").bufferedReader().use { it.readText() } }
    @Volatile private var stops = 0

    /**
     * Distills every character's heard-but-not-yet-remembered exchanges into their notes, in a
     * scratch context (the live conversation is untouched). Meant for when the app goes to the
     * background; any stop() (you came back and spoke) ends it, and the rest waits for next time.
     * New notes reach a character's prompt at the next launch or character switch.
     */
    fun remember(onDone: (String) -> Unit) {
        // Counted here, on the caller's thread: a stop() after leaving (you came back and spoke while
        // this waited behind a reply) must still cancel it (review 2026-09-28).
        val since = stops
        val gen0 = NativeLlm.cancelGen()
        llmExec.execute {
            val report = mutableListOf<String>()
            run all@{
                val order = memory.distillOrder(CHARACTERS.map { it.id })
                for (c in CHARACTERS.sortedBy { order.indexOf(it.id) }) {
                    var notes = memory.notes(c.id)
                    chunks@ for ((conversation, n) in Memory.chunks(memory.pending(c.id), c.name)) {
                        if (stops != since) { report += "${c.name}: paused (you came back)"; return@all }
                        memory.markTried(c.id)
                        val t0 = SystemClock.elapsedRealtime()
                        val out = NativeLlm.completeIsolated(DISTILL_SYSTEM, Memory.fill(distillTemplate, c.name, notes, conversation), 250, 4096)
                        val secs = (SystemClock.elapsedRealtime() - t0) / 1000
                        if (stops != since) { report += "${c.name}: paused (you came back, ${secs} s into a chunk)"; return@all }
                        // Failed (no memory for a scratch context, too long, ...): keep the exchanges for next time.
                        if (out == null) { report += "${c.name}: couldn't distill, kept for next time"; break@chunks }
                        val added = Memory.parse(out)
                        notes = Memory.merge(notes, added)
                        memory.saveNotes(c.id, notes)
                        memory.logWishes(c.id, added.filter { it.tag == Memory.Tag.WISH }.map { it.text }, java.time.LocalDate.now().toString())
                        memory.consume(c.id, n)
                        report += "${c.name} +${added.size} (${n} exchanges in ${secs} s)" + added.joinToString("") { "\n  $it" }
                    }
                }
            }
            // New notes change the prompts: prime them now, while you're away, so the next launch or
            // switch loads them instead of reading them.
            primeStaleCaches(since, gen0, report)
            onDone(report.joinToString("\n"))
        }
    }

    /** You started talking: get the brain back from any background priming now, not at end of turn. */
    fun onVoiceHeard() = NativeLlm.cancelPrime()

    fun hasUnremembered(): Boolean = CHARACTERS.any { memory.pending(it.id).isNotEmpty() }
    /** Something for remember() to do while you're away: memories to distill or prompts to prime. */
    fun hasBackgroundWork(): Boolean = hasUnremembered() || CHARACTERS.any { !cacheFresh(it, systemPrompt(it)) }

    /** Everything each character remembers, for the Models menu. */
    fun memoryReport(): String = CHARACTERS.joinToString("\n\n") { c ->
        val notes = memory.notes(c.id)
        val waiting = memory.pending(c.id).size
        "${c.name}${if (waiting > 0) " ($waiting exchanges not remembered yet)" else ""}\n" +
            (if (notes.isEmpty()) "  nothing yet" else notes.joinToString("\n") { "  $it" }) +
            memory.wishLog(c.id).let { log -> if (log.isEmpty()) "" else "\n  every wish so far (${log.size}):" + log.joinToString("") { "\n    $it" } }
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
        stops++
        // Read the gate under the lock: a say(held) on another thread may be installing a new one.
        val (wasHeld, gate) = synchronized(holdLock) {
            val h = heldTurn != 0
            heldTurn = 0
            deferred.clear()
            h to holdGate
        }
        if (speaking && !wasHeld) {
            speakingEndedAt = now()
            ui.onInterrupted()
        }
        // Cut off before you heard a word: take the reply back, so your next words join your last ones.
        // Only that turn's own reply (if it ran at all: trace.llm is set on the llm thread, before this
        // task). A dropped early start also takes back your words: the final utterance re-sends all of them.
        val t = activeTrace
        val unheard = activeTurn != 0 && t != null && t.firstAudioAt == 0L
        activeTurn = 0
        synchronized(turnLock) { currentTurn++ }
        NativeLlm.cancel()
        NativeLlm.hold(false)
        ttsQueue.clear()
        gate.countDown()
        if (::audio.isInitialized) audio.flush()
        if (unheard) llmExec.execute { t!!.llm?.let { NativeLlm.retractLastReply(it.replyId, dropUser = t.early && !t.committed) } }
    }

    private fun ttsLoop() {
        while (true) {
            val job = ttsQueue.take()
            if (job.turn != currentTurn) continue
            when (job) {
                is TtsJob.Speak -> try {
                    val text = SpeechText.clean(job.text)
                    if (!SpeechText.speakable(text)) continue
                    val t0 = now()
                    synchronized(voiceLock) {
                        if (job.turn != currentTurn) return@synchronized
                        val v = voice
                        var samples = v.synth(text, v.engine.speakerFor(character.id), character.speed)
                        robot?.let { samples = it.apply(samples) }
                        val synthMs = now() - t0
                        if (job.first && job.trace.voiceFirst) NativeLlm.hold(false)
                        val audioMs = samples.size * 1000L / v.sampleRate
                        job.trace.chunks += TurnTrace.Chunk(text.length, synthMs, audioMs)
                        if (job.turn != currentTurn) return@synchronized
                        // An early start stays silent until your end of turn commits it (or stop() drops it).
                        if (job.turn == heldTurn) holdGate.await()
                        if (job.turn != currentTurn) return@synchronized
                        val env = Envelope.of(samples, v.sampleRate, ENVELOPE_FRAME_MS)
                        audio.enqueue(samples, onStart = {
                            if (job.trace.firstAudioAt == 0L) job.trace.firstAudioAt = now()
                            job.trace.plays += TurnTrace.Play(now(), audioMs)
                            if (job.turn == currentTurn) {
                                job.emotion?.let(ui::onEmotion)
                                ui.onSpeechChunk(env, ENVELOPE_FRAME_MS)
                            }
                        })
                    }
                } finally {
                    if (job.first && job.trace.voiceFirst) NativeLlm.hold(false) // every path, incl. unspeakable/dropped chunks
                }
                is TtsJob.End -> {
                    // A held reply with nothing speakable must not end (and discard your utterance) before commit.
                    if (job.turn == heldTurn) holdGate.await()
                    if (job.turn != currentTurn) continue
                    synchronized(voiceLock) { audio }.marker {
                        if (activeTurn == job.turn) { activeTurn = 0; speakingEndedAt = now() }
                        job.trace.doneAt = now()
                        job.trace.memAfter = MemProbe.read(ctx)
                        job.trace.heat = heat()
                        // Heard to the end: worth remembering (distilled later by remember()).
                        memory.addExchange(job.trace.characterId, job.trace.userText, SpeechText.clean(job.trace.replyText))
                        memory.touch(job.trace.characterId)
                        lastHeard = job.trace
                        if (job.trace.readings != null) selfTracker.heard()
                        ui.onTurnDone(job.turn, job.trace.report())
                    }
                }
            }
        }
    }

    private fun now() = SystemClock.elapsedRealtime()

    private val power = ctx.getSystemService(PowerManager::class.java)
    /** The thermal governor's current avatar level, for the turn report. */
    @Volatile var heatLevel = "cool"
    /** The governor's last (status, headroom) reading; the turn report never calls the API itself. */
    @Volatile var heatReading: () -> Pair<Int, Float> = { power.currentThermalStatus to Float.NaN }

    /** Thermal status (0 none .. 6 shutdown) and headroom (1.0 = throttling starts), to explain slow turns. */
    private fun heat(): String {
        val (status, headroom) = heatReading()
        return "status $status, headroom ${"%.2f".format(headroom)}, avatar $heatLevel"
    }

    companion object {
        /** 2048 left Unit Seven ~4 exchanges beside his ~1,400-token prompt (notes + self-knowledge); ~+285 MB KV. */
        const val N_CTX = 4096
        const val LLM_THREADS = 4
        /** llama-bench on S24 Ultra, Gemma 3 4B pp256: 4 threads 51.4 tok/s, 6 threads 44.8, 8 threads 50.5. */
        const val LLM_BATCH_THREADS = 4
        const val MAX_REPLY_TOKENS = 400 // 160 cut a requested song mid-outro; Stop still cuts long replies
        /** After she stops, mic text matching her words is still treated as echo for this long. */
        const val ECHO_WINDOW_MS = 3000L // echo tail + 0.8 s end-of-turn wait + decode
        const val ENVELOPE_FRAME_MS = 20
        /**
         * A/B "voice first": pause generation while the first chunk synthesizes. Mac M3: Supertonic
         * synth 330 ms alone vs 1,136 ms beside 4-thread Gemma generation; the phone's first-chunk
         * synth is ~1.2 s. On since 0.15.3 (phone B-all round: first-chunk synth ~10% faster, no harm seen).
         */
        const val VOICE_FIRST = true
        const val DISTILL_SYSTEM = "You write memory notes. Follow the format exactly."

    }
}

class TurnTrace(val turn: Int, val who: String, val t0: Long) {
    companion object {
        /** Below this the AudioTrack buffer (~2x min size) hides it; above it you hear a pause. */
        const val GAP_MIN_MS = 120L
    }

    @Volatile var character = ""
    @Volatile var characterId = ""
    @Volatile var userText = ""
    @Volatile var replyText = ""
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
    @Volatile var heat = ""
    /** FTT: started at a short pause, before your end of turn; [committedAt] when that end came. */
    @Volatile var voiceFirst = false
    /** Smart Turn's P(done) at the pause that started this turn, or -1. */
    @Volatile var turnProb = -1f
    /** Unit Seven's <<readings>> sent with this turn, if any (SelfReport). */
    @Volatile var readings: String? = null
    @Volatile var early = false
    @Volatile var committed = false
    @Volatile var committedAt = 0L
    @Volatile var earlyTally = ""
    val chunks: MutableList<Chunk> = java.util.Collections.synchronizedList(mutableListOf())
    val emotions: MutableList<Emotion> = java.util.Collections.synchronizedList(mutableListOf())
    /** When each chunk started playing and how long it is: silence between chunks = the voice falling behind. */
    class Play(val at: Long, val audioMs: Long)
    val plays: MutableList<Play> = java.util.Collections.synchronizedList(mutableListOf())

    /** Gaps (ms) before chunk 2, 3, ...: how much later each started than the previous one ended. */
    fun gaps(): List<Long> = synchronized(plays) {
        plays.zipWithNext { a, b -> maxOf(0L, b.at - (a.at + a.audioMs)) }
    }

    private fun rel(t: Long) = if (t == 0L) "—" else "${t - t0} ms"

    fun report(): String = buildString {
        val l = llm
        appendLine("TURN #$turn ($who)${if (heardAt > 0) " [voice]" else ""}")
        if (heardAt > 0 && firstAudioAt > 0) {
            appendLine("  you stopped -> her voice : ${firstAudioAt - heardAt} ms   <- from your last sound (incl. end-of-turn wait)")
            if (recognizeMs > 0) appendLine("  2nd-pass recognize      : $recognizeMs ms (included above)")
            if (early) appendLine("  early start             : brain started ${t0 - heardAt} ms after you stopped, end of turn at ${committedAt - heardAt} ms ($earlyTally)")
            if (turnProb >= 0f) appendLine("  smart turn              : P(done) %.2f at the pause%s".format(turnProb, if (turnProb >= TurnDetector.THRESHOLD) ", ended the turn early" else ", waited for the silence rule"))
        }
        appendLine("  first audio : ${rel(firstAudioAt)}   <- time until you hear a voice")
        append("  first token : ${rel(firstPieceAt)}")
        if (l != null) append("  (prefill ${l.promptTokens} tok in ${"%.0f".format(l.prefillMs)} ms)")
        appendLine()
        appendLine("  first chunk : ${rel(firstChunkAt)}  \"${firstChunkText.take(40)}\"")
        if (l != null) {
            appendLine("  LLM         : ${l.genTokens} tok @ ${"%.1f".format(l.tokPerSec)} tok/s, done ${rel(llmDoneAt)}" +
                (if (l.rebuilt) " [history trimmed, shift kept ${l.shiftReused} tok]" else "") + (if (l.cancelled) " [cancelled]" else ""))
        }
        val synth = chunks.sumOf { it.synthMs }
        val audio = chunks.sumOf { it.audioMs }
        val first = chunks.firstOrNull()
        appendLine("  TTS         : ${chunks.size} chunks, synth ${synth} ms for ${audio} ms audio" +
            (if (audio > 0) " (RTF ${"%.2f".format(synth.toDouble() / audio)})" else "") +
            (if (first != null) ", first chunk synth ${first.synthMs} ms" else "") + (if (voiceFirst) " [voice first]" else ""))
        val g = gaps().filter { it >= GAP_MIN_MS }
        if (plays.size > 1) appendLine("  gaps        : " + if (g.isEmpty()) "none" else
            "${g.size} (total ${g.sum()} ms, longest ${g.max()} ms, after the first chunk ${gaps().first()} ms)")
        appendLine("  total       : ${rel(doneAt)}")
        if (emotions.isNotEmpty()) appendLine("  feeling     : ${emotions.joinToString(" -> ") { it.tag }}")
        val a = memAfter
        if (a != null) append("  RAM         : rss ${a.rssMb} MB, peak ${a.peakRssMb} MB | avail ${a.availMb}/${a.totalMb} MB${if (a.lowMemory) " LOW" else ""}")
        if (heat.isNotEmpty()) append("\n  heat        : $heat")
    }
}
