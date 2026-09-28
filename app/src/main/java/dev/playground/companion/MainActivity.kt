package dev.playground.companion

import android.app.Activity
import android.content.ClipData
import android.content.ClipboardManager
import android.content.pm.PackageManager
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.graphics.Color
import android.graphics.Typeface
import android.os.Build
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.view.WindowInsets
import android.view.inputmethod.EditorInfo
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import android.Manifest
import android.app.AlertDialog
import dev.playground.companion.engine.AsrEngine
import dev.playground.companion.engine.Emotion
import dev.playground.companion.engine.Ears
import dev.playground.companion.engine.LlmModel
import dev.playground.companion.engine.Transcriber
import dev.playground.companion.engine.VoiceEngine
import kotlin.concurrent.thread

/** Test bench UI for the spine. Deliberately plain: the avatar comes later. */
class MainActivity : Activity(), Pipeline.Listener {
    private lateinit var store: ModelStore
    private lateinit var pipeline: Pipeline

    private lateinit var status: TextView
    private lateinit var transcript: TextView
    private lateinit var metrics: TextView
    private lateinit var input: EditText
    private lateinit var send: Button
    private lateinit var download: Button
    private lateinit var avatar: AvatarView
    private lateinit var voiceButton: Button
    @Volatile private var lastVoiceAt = 0L
    private lateinit var micButton: Button
    private var ears: Ears? = null
    @Volatile private var micOn = false
    private val charButtons = mutableListOf<Button>()
    private val prefs by lazy { getSharedPreferences("companion", MODE_PRIVATE) }
    private var liveTurn = -1
    /** Reply text of turns not shown yet (an early start before its commit), by turn id. UI thread only. */
    private val pendingText = HashMap<Int, StringBuilder>()

    private fun goLive(turn: Int) {
        liveTurn = turn
        pendingText.remove(turn)?.let(transcript::append)
        pendingText.keys.removeAll { it < turn }
    }
    private val reports = StringBuilder()
    private val ignoredLog = StringBuilder()
    private lateinit var log: SessionLog

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        store = ModelStore(applicationContext)
        log = SessionLog(applicationContext)
        val saved = runCatching { VoiceEngine.valueOf(prefs.getString(PREF_VOICE, "")!!) }.getOrNull()
        val savedLlm = runCatching { LlmModel.valueOf(prefs.getString(PREF_LLM, "")!!) }.getOrNull()
        pipeline = Pipeline(applicationContext, store, this, saved ?: ModelStore.DEFAULT_VOICE, savedLlm ?: ModelStore.DEFAULT_LLM)
        val root = buildUi()
        setContentView(root)
        // Target SDK 35 draws edge-to-edge: pad for the status/nav bars and the keyboard,
        // or the bottom buttons sit under Android's navigation bar.
        val pad = (12 * resources.displayMetrics.density).toInt()
        root.setOnApplyWindowInsetsListener { v, insets ->
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                val b = insets.getInsets(WindowInsets.Type.systemBars() or WindowInsets.Type.ime())
                v.setPadding(pad + b.left, pad + b.top, pad + b.right, pad + b.bottom)
            } else {
                @Suppress("DEPRECATION")
                v.setPadding(pad + insets.systemWindowInsetLeft, pad + insets.systemWindowInsetTop,
                    pad + insets.systemWindowInsetRight, pad + insets.systemWindowInsetBottom)
            }
            insets
        }
        if (store.ready()) startPipeline() else showDownload()
    }

    private fun buildUi(): View {
        val pad = (12 * resources.displayMetrics.density).toInt()
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.rgb(16, 16, 20))
        }
        val chars = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        CHARACTERS.forEach { c ->
            val b = Button(this).apply {
                text = c.name
                isEnabled = false
                setOnClickListener { selectCharacter(c) }
            }
            charButtons += b
            chars.addView(b, LinearLayout.LayoutParams(0, -2, 1f))
        }
        root.addView(chars)

        avatar = AvatarView(this) { name -> store.avatarFile(name) }
        root.addView(avatar, LinearLayout.LayoutParams(-1, 0, 2.2f))
        root.addView(feelingsStrip())
        applyLook(prefs.getString(PREF_LOOK, "human") ?: "human")

        status = label(14f, Color.rgb(150, 200, 255)).apply { text = "Starting…" }
        root.addView(status)
        download = Button(this).apply {
            text = "Download models (once)"
            visibility = View.GONE
            setOnClickListener { runDownload() }
        }
        root.addView(download)

        transcript = label(16f, Color.WHITE)
        root.addView(ScrollView(this).apply { addView(transcript) }, LinearLayout.LayoutParams(-1, 0, 1.0f))

        metrics = label(11f, Color.rgb(170, 255, 170)).apply { typeface = Typeface.MONOSPACE }
        root.addView(ScrollView(this).apply { addView(metrics) }, LinearLayout.LayoutParams(-1, 0, 0.55f))

        val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
        input = EditText(this).apply {
            hint = "Say something…"
            setTextColor(Color.WHITE)
            setHintTextColor(Color.GRAY)
            imeOptions = EditorInfo.IME_ACTION_SEND
            isSingleLine = true
            setOnEditorActionListener { _, _, _ -> submit(); true }
        }
        row.addView(input, LinearLayout.LayoutParams(0, -2, 1f))
        send = Button(this).apply { text = "Send"; isEnabled = false; setOnClickListener { submit() } }
        row.addView(send)
        row.addView(Button(this).apply { text = "Stop"; setOnClickListener { pipeline.stop() } })
        root.addView(row)

        val tools = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        voiceButton = Button(this).apply {
            isEnabled = false
            setOnClickListener { cycleVoice() }
        }
        tools.addView(voiceButton, LinearLayout.LayoutParams(0, -2, 1.3f))
        micButton = Button(this).apply {
            text = "Mic: off"
            isEnabled = false
            setOnClickListener { toggleMic() }
        }
        tools.addView(micButton, LinearLayout.LayoutParams(0, -2, 1f))
        tools.addView(Button(this).apply {
            text = "Models…"
            setOnClickListener { showModelsMenu() }
        }, LinearLayout.LayoutParams(0, -2, 1f))
        tools.addView(Button(this).apply {
            text = "Copy report"
            setOnClickListener {
                val text = pipeline.loadReport + "\n\n" + reports + ignoredLog
                (getSystemService(CLIPBOARD_SERVICE) as ClipboardManager).setPrimaryClip(ClipData.newPlainText("report", text))
                Toast.makeText(this@MainActivity, "Report copied", Toast.LENGTH_SHORT).show()
            }
        }, LinearLayout.LayoutParams(0, -2, 1f))
        root.addView(tools)
        return root
    }

    /**
     * Test strip for how feelings read on the avatar: A/B intensity profile, each emotion,
     * and "talk" (fake lip-sync) to feel an emotion while speaking. Persists the profile.
     */
    private fun feelingsStrip(): View {
        val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        fun chip(text: String, onClick: (Button) -> Unit) = Button(this).apply {
            this.text = text
            isAllCaps = false
            textSize = 12f
            minWidth = 0; minimumWidth = 0
            setOnClickListener { onClick(this) }
            row.addView(this)
        }
        var profile = prefs.getString(PREF_PROFILE, "A") ?: "A"
        avatar.setProfile(profile)
        chip("Profile $profile") { b ->
            profile = if (profile == "A") "B" else "A"
            prefs.edit().putString(PREF_PROFILE, profile).apply()
            avatar.setProfile(profile)
            b.text = "Profile $profile"
        }
        Emotion.entries.forEach { e -> chip(e.tag) { avatar.setEmotion(e.tag) } }
        chip("talk") { talkTest() }
        return android.widget.HorizontalScrollView(this).apply { addView(row) }
    }

    /** ~3 s of syllable-like mouth movement, then back to idle (as a real reply would). */
    private fun talkTest() {
        if (avatar.state != "idle") return
        val frames = 150
        val env = FloatArray(frames) { i ->
            val syllable = 0.5f + 0.5f * kotlin.math.sin(i * 0.55f)
            val word = if ((i / 18) % 4 == 3) 0.15f else 1f          // short pauses between words
            (syllable * word * 0.9f).coerceIn(0f, 1f)
        }
        avatar.speak(env, 20, 0)
        avatar.postDelayed({ if (avatar.state == "speaking") avatar.setState("idle") }, frames * 20L + 200)
    }

    private fun label(size: Float, color: Int) = TextView(this).apply {
        textSize = size
        setTextColor(color)
        setTextIsSelectable(true)
    }

    private fun showDownload() {
        status.text = "Models not downloaded yet."
        download.visibility = View.VISIBLE
    }

    private fun runDownload() {
        download.isEnabled = false
        thread(name = "download") {
            try {
                store.ensure { what, done, total ->
                    val pct = if (total > 0) " ${done * 100 / total}% (${done shr 20}/${total shr 20} MB)" else ""
                    runOnUiThread { status.text = "$what$pct" }
                }
                runOnUiThread { download.visibility = View.GONE; startPipeline() }
            } catch (e: Exception) {
                runOnUiThread {
                    status.text = "Download failed: ${e.message}. Tap to resume."
                    download.isEnabled = true
                }
            }
        }
    }

    private fun startPipeline() {
        pipeline.load {
            runOnUiThread {
                metrics.text = pipeline.loadReport + "\n"
                log.report(pipeline.loadReport)
                log.event("talking to ${pipeline.character.name}, brain ${pipeline.llmModel.label}, voice ${pipeline.voiceEngine.label}")
                send.isEnabled = true
                charButtons.forEach { it.isEnabled = true }
                voiceButton.isEnabled = true
                voiceButton.text = "Voice: ${pipeline.voiceEngine.label}"
                micButton.isEnabled = true
                status.text = "Ready · brain: ${pipeline.llmModel.label} (change in Models…)"
                highlight()
                avatar.setCharacter(pipeline.character.id)
            }
        }
    }

    private fun cycleVoice() {
        if (!send.isEnabled) return
        val all = VoiceEngine.entries
        val next = all[(all.indexOf(pipeline.voiceEngine) + 1) % all.size]
        val note = if (store.voiceReady(next)) "" else " (downloading ~${next.approxMb} MB)"
        send.isEnabled = false
        voiceButton.isEnabled = false
        transcript.append("\n— switching voice to ${next.label}$note —\n")
        log.event("voice -> ${next.label}")
        pipeline.switchVoice(next) { err ->
            runOnUiThread {
                if (err == null) prefs.edit().putString(PREF_VOICE, next.name).apply()
                voiceButton.text = "Voice: ${pipeline.voiceEngine.label}"
                voiceButton.isEnabled = true
                send.isEnabled = true
            }
        }
    }

    /** Brains first (the thing people come here for), then recognizers, then benchmarks. */
    private fun showModelsMenu() {
        if (!send.isEnabled) return
        val current = asrEngine()
        val recognizers = AsrEngine.entries.map { e ->
            val mark = if (e == current) "✓ " else ""
            val size = if (store.asr2Ready(e)) "" else " (download ${e.approxMb} MB)"
            "${mark}Recognizer: ${e.label}$size"
        }
        val brains = LlmModel.entries.map { m ->
            val mark = if (m == pipeline.llmModel) "✓ " else ""
            val size = if (store.llmReady(m)) "" else " (download ${"%.1f".format(m.approxMb / 1024f)} GB)"
            "${mark}Brain: ${m.label}$size"
        }
        val benches = listOf("Bench voices", "Bench recognizers on my last ${ears?.recent?.size ?: 0} utterances", "Share this session's log")
        val looks = listOf("human" to "Look: humans (VRM)", "orb" to "Look: plasma orbs").map { (id, label) ->
            (if (id == (prefs.getString(PREF_LOOK, "human") ?: "human")) "✓ " else "") + label
        }
        val items = brains + recognizers + looks + benches
        AlertDialog.Builder(this).setTitle("Models").setItems(items.toTypedArray()) { _, which ->
            val firstRecognizer = brains.size
            val firstLook = firstRecognizer + recognizers.size
            val firstBench = firstLook + looks.size
            when {
                which < firstRecognizer -> switchBrain(LlmModel.entries[which])
                which < firstLook -> {
                    val e = AsrEngine.entries[which - firstRecognizer]
                    prefs.edit().putString(PREF_ASR, e.name).apply()
                    transcript.append("\n— recognizer: ${e.label} —\n")
                    if (micOn) loadSecondPass()
                }
                which < firstBench -> {
                    val look = if (which == firstLook) "human" else "orb"
                    prefs.edit().putString(PREF_LOOK, look).apply()
                    applyLook(look)
                    log.event("look -> $look")
                }
                which == firstBench -> runBench { onPartial, onDone -> pipeline.benchVoice(onPartial, onDone) }
                which == firstBench + 1 -> runBench { onPartial, onDone -> pipeline.benchAsr(ears?.recent?.toList().orEmpty(), onPartial, onDone) }
                else -> shareLog()
            }
        }.show()
    }

    private fun switchBrain(m: LlmModel) {
        if (m == pipeline.llmModel) return
        send.isEnabled = false
        val note = if (store.llmReady(m)) "" else " (downloading ~${"%.1f".format(m.approxMb / 1024f)} GB)"
        transcript.append("\n— switching brain to ${m.label}$note —\n")
        log.event("brain -> ${m.label}")
        pipeline.switchLlm(m) { err ->
            runOnUiThread {
                if (err == null) prefs.edit().putString(PREF_LLM, m.name).apply()
                status.text = "Ready · brain: ${pipeline.llmModel.label}"
                send.isEnabled = true
            }
        }
    }

    /** Sends the session log through the Android share sheet (Drive, messengers, email…). */
    private fun shareLog() = thread(name = "share-log") {
        var text = log.readAll()
        if (text.length > MAX_SHARE_CHARS) text = "…(start trimmed)…\n" + text.takeLast(MAX_SHARE_CHARS)
        runOnUiThread {
            val send = android.content.Intent(android.content.Intent.ACTION_SEND).apply {
                type = "text/plain"
                putExtra(android.content.Intent.EXTRA_SUBJECT, log.file.name)
                putExtra(android.content.Intent.EXTRA_TEXT, text)
            }
            startActivity(android.content.Intent.createChooser(send, "Share session log"))
        }
    }

    /**
     * Humans need their VRM models downloaded once (~34 MB); until then Mira and Kai show as
     * orbs and switch over by themselves when the download finishes.
     */
    private fun applyLook(look: String) {
        if (look != "human" || store.avatarsReady()) { avatar.setLook(look); return }
        avatar.setLook("orb")
        thread(name = "avatars") {
            try {
                store.ensureAvatars { what, done, total ->
                    val pct = if (total > 0) " ${done * 100 / total}%" else ""
                    runOnUiThread { status.text = "$what$pct (orbs until then)" }
                }
                runOnUiThread {
                    if (prefs.getString(PREF_LOOK, "human") == "human") avatar.setLook("human")
                    status.text = "Humans ready"
                }
            } catch (t: Throwable) {
                runOnUiThread { status.text = "Avatar download failed: ${t.message} (Models… > Look to retry)" }
            }
        }
    }

    private fun runBench(start: (onPartial: (String) -> Unit, onDone: (String) -> Unit) -> Unit) {
        send.isEnabled = false
        start({ partial -> runOnUiThread { metrics.text = partial } }) { report ->
            runOnUiThread {
                reports.append(report).append("\n\n")
                metrics.text = report
                send.isEnabled = true
            }
        }
    }

    private fun asrEngine() = runCatching { AsrEngine.valueOf(prefs.getString(PREF_ASR, "")!!) }.getOrDefault(AsrEngine.PARAKEET)

    /** Downloads (once) and loads the chosen second-pass recognizer in the background. */
    private fun loadSecondPass() {
        val e = asrEngine()
        val ears = ears ?: return
        if (ears.secondPass?.engine == e) return
        thread(name = "asr2-load") {
            try {
                store.ensureAsr2(e) { what, done, total ->
                    val pct = if (total > 0) " ${done * 100 / total}% (${done shr 20}/${total shr 20} MB)" else ""
                    runOnUiThread { status.text = "$what$pct — mic works meanwhile" }
                }
                runOnUiThread { status.text = "Loading ${e.label}…" }
                val t0 = android.os.SystemClock.elapsedRealtime()
                val t = Transcriber(e, store.asr2Dir(e))
                val old = ears.secondPass
                ears.secondPass = t
                old?.release()
                val ms = android.os.SystemClock.elapsedRealtime() - t0
                runOnUiThread {
                    status.text = "Listening…"
                    metrics.append("\nMIC   2nd pass: ${e.label} (loaded in $ms ms)\n")
                }
            } catch (t: Throwable) {
                runOnUiThread { status.text = "Recognizer failed: ${t.message} (streaming only)" }
            }
        }
    }

    private fun toggleMic() {
        if (micOn) {
            micOn = false
            ears?.stop()
            setCallMode(false)
            micButton.text = "Mic: off"
            status.text = "Ready"
            return
        }
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO), REQ_MIC)
            return
        }
        micButton.isEnabled = false
        thread(name = "ears-load") {
            try {
                store.ensureEars { what, done, total ->
                    val pct = if (total > 0) " ${done * 100 / total}%" else ""
                    runOnUiThread { status.text = "$what$pct" }
                }
                val e = ears ?: Ears(store.asrDir, store.vadFile, earsListener).also { ears = it }
                runOnUiThread { setCallMode(true) }
                e.start()
                micOn = true
                runOnUiThread {
                    micButton.text = "Mic: on"
                    micButton.isEnabled = true
                    status.text = "Listening…"
                    Thread { Thread.sleep(800); runOnUiThread { metrics.append("\nMIC   echo canceller: ${if (e.echoCancel) "on" else "unavailable"}\n") } }.start()
                    loadSecondPass()
                }
            } catch (t: Throwable) {
                runOnUiThread {
                    status.text = "Mic failed: ${t.message}"
                    micButton.isEnabled = true
                }
            }
        }
    }

    /** Call audio mode on the loudspeaker while listening, so echo cancellation has a reference. */
    private fun setCallMode(on: Boolean) {
        val am = getSystemService(AUDIO_SERVICE) as AudioManager
        if (on) {
            am.mode = AudioManager.MODE_IN_COMMUNICATION
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                am.availableCommunicationDevices.firstOrNull { it.type == AudioDeviceInfo.TYPE_BUILTIN_SPEAKER }
                    ?.let { am.setCommunicationDevice(it) }
            } else {
                @Suppress("DEPRECATION")
                am.isSpeakerphoneOn = true
            }
        } else {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                am.clearCommunicationDevice()
            } else {
                @Suppress("DEPRECATION")
                am.isSpeakerphoneOn = false
            }
            am.mode = AudioManager.MODE_NORMAL
        }
        pipeline.setVoiceCallAudio(on)
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == REQ_MIC && grantResults.firstOrNull() == PackageManager.PERMISSION_GRANTED) toggleMic()
        else if (requestCode == REQ_MIC) status.text = "Microphone permission denied"
    }

    private val earsListener = object : Ears.Listener {
        override fun onPartial(text: String) {
            if (!micOn) return
            runOnUiThread { status.text = if (text.isEmpty()) "Listening…" else "hearing: $text" }
        }

        override fun onSpeechActivity(partial: String) {
            if (!micOn) return
            lastVoiceAt = android.os.SystemClock.elapsedRealtime()
            if (pipeline.onUserSpeech(partial)) runOnUiThread { transcript.append(" [interrupted]") }
            runOnUiThread {
                if (avatar.state == "idle") {
                    avatar.setState("listening")
                    avatar.postDelayed(listeningTimeout, LISTEN_TIMEOUT_MS)
                }
            }
        }

        override fun onShortPause(text: String, lastVoiceAt: Long, voicedMs: Int, recognizeMs: Long) {
            if (!micOn || !send.isEnabled) return
            pipeline.onUserPause(text, lastVoiceAt, voicedMs, recognizeMs)
        }

        override fun onFinal(text: String, lastVoiceAt: Long, voicedMs: Int, recognizeMs: Long) {
            if (!micOn || !send.isEnabled) return
            val heard = pipeline.onUserUtterance(text, lastVoiceAt, voicedMs, recognizeMs)
            runOnUiThread {
                when (heard) {
                    is Pipeline.Heard.Ignored -> {
                        status.text = "(ignored \"$text\": ${heard.reason})"
                        ignoredLog.append("IGNORED \"$text\" (${heard.reason}, voiced ${voicedMs} ms)\n")
                        log.event("mic ignored \"$text\" (${heard.reason})")
                    }
                    is Pipeline.Heard.Turn -> {
                        transcript.append("\nYou 🎤: $text\n${pipeline.character.name}: ")
                        goLive(heard.id)
                    }
                }
            }
        }
    }

    /** Back to idle if the voice stopped and nothing (a turn, an ignored blip) moved it on. */
    private val listeningTimeout = object : Runnable {
        override fun run() {
            if (avatar.state != "listening") return
            if (android.os.SystemClock.elapsedRealtime() - lastVoiceAt >= LISTEN_TIMEOUT_MS) avatar.setState("idle")
            else avatar.postDelayed(this, LISTEN_TIMEOUT_MS)
        }
    }

    private val governor by lazy {
        dev.playground.companion.engine.ThermalGovernor(this) { lv ->
            avatar.setQuality(lv.fps, lv.pixelRatio)
            pipeline.heatLevel = lv.name.lowercase()
            log.event("heat: avatar ${lv.name.lowercase()} (${lv.fps} fps, pixel ratio ${lv.pixelRatio})")
        }
    }

    override fun onPause() {
        super.onPause()
        governor.stop()
        avatar.pauseRendering()
    }

    override fun onResume() {
        super.onResume()
        avatar.resumeRendering()
        governor.start()
    }

    override fun onDestroy() {
        avatar.destroy()
        ears?.release()
        if (micOn) setCallMode(false)
        super.onDestroy()
    }

    private fun selectCharacter(c: Character) {
        pipeline.select(c)
        avatar.setCharacter(c.id)
        avatar.setState("idle")
        avatar.setEmotion("calm")
        transcript.append("\n— now talking to ${c.name} —\n")
        log.event("now talking to ${c.name}")
        highlight()
    }

    private fun highlight() = charButtons.forEachIndexed { i, b ->
        b.alpha = if (CHARACTERS[i] == pipeline.character) 1f else 0.5f
    }

    private fun submit() {
        val text = input.text.toString().trim()
        if (text.isEmpty() || !send.isEnabled) return
        input.setText("")
        transcript.append("\nYou: $text\n${pipeline.character.name}: ")
        goLive(pipeline.say(text))
    }

    override fun onStatus(text: String) = runOnUiThread { status.text = text }

    override fun onReplyText(turn: Int, piece: String) = runOnUiThread {
        if (turn == liveTurn) transcript.append(piece)
        else if (turn > liveTurn) pendingText.getOrPut(turn) { StringBuilder() }.append(piece)
    }

    override fun onThinking() = runOnUiThread { avatar.setState("thinking") }

    override fun onEmotion(emotion: dev.playground.companion.engine.Emotion) = runOnUiThread { avatar.setEmotion(emotion.tag) }

    override fun onSpeechChunk(envelope: FloatArray, frameMs: Int) = runOnUiThread {
        avatar.speak(envelope, frameMs, if (micOn) CALL_AUDIO_DELAY_MS else MEDIA_AUDIO_DELAY_MS)
    }

    override fun onInterrupted() = runOnUiThread {
        avatar.stopSpeaking()
        avatar.flinch()
        avatar.setState("listening")
    }

    override fun onReplyComplete(trace: TurnTrace) =
        log.turn(trace.character, trace.userText, trace.replyText, trace.emotions.joinToString(" -> ") { it.tag })

    override fun onTurnDone(turn: Int, report: String) = runOnUiThread {
        log.report(report)
        // She finished: throw away her echo tail so it can't become a fake user utterance.
        ears?.discardUtterance()
        avatar.setState("idle")
        reports.append(report).append("\n\n")
        metrics.text = pipeline.loadReport + "\n\n" + report
    }

    private companion object {
        const val PREF_VOICE = "voice_engine"
        const val REQ_MIC = 1
        const val PREF_ASR = "asr_engine"
        const val PREF_PROFILE = "emotion_profile"
        const val PREF_LOOK = "avatar_look"
        const val PREF_LLM = "llm_model"
        const val LISTEN_TIMEOUT_MS = 1500L
        /** Share-sheet text travels through Binder (~1 MB limit); keep well under it. */
        const val MAX_SHARE_CHARS = 300_000
        // Rough output latency so the mouth moves with the sound, not before it (tune by eye).
        const val MEDIA_AUDIO_DELAY_MS = 90
        const val CALL_AUDIO_DELAY_MS = 140
    }
}
