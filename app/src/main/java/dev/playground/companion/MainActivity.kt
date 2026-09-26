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
import dev.playground.companion.engine.Ears
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
    private lateinit var voiceButton: Button
    private lateinit var micButton: Button
    private var ears: Ears? = null
    @Volatile private var micOn = false
    private val charButtons = mutableListOf<Button>()
    private val prefs by lazy { getSharedPreferences("companion", MODE_PRIVATE) }
    private var liveTurn = -1
    private val reports = StringBuilder()
    private val ignoredLog = StringBuilder()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        store = ModelStore(filesDir)
        val saved = runCatching { VoiceEngine.valueOf(prefs.getString(PREF_VOICE, "")!!) }.getOrNull()
        pipeline = Pipeline(applicationContext, store, this, saved ?: ModelStore.DEFAULT_VOICE)
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

        status = label(14f, Color.rgb(150, 200, 255)).apply { text = "Starting…" }
        root.addView(status)
        download = Button(this).apply {
            text = "Download models (~1.25 GB, once)"
            visibility = View.GONE
            setOnClickListener { runDownload() }
        }
        root.addView(download)

        transcript = label(16f, Color.WHITE)
        root.addView(ScrollView(this).apply { addView(transcript) }, LinearLayout.LayoutParams(-1, 0, 1.2f))

        metrics = label(11f, Color.rgb(170, 255, 170)).apply { typeface = Typeface.MONOSPACE }
        root.addView(ScrollView(this).apply { addView(metrics) }, LinearLayout.LayoutParams(-1, 0, 1f))

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
            text = "Bench…"
            setOnClickListener { showBenchMenu() }
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
                send.isEnabled = true
                charButtons.forEach { it.isEnabled = true }
                voiceButton.isEnabled = true
                voiceButton.text = "Voice: ${pipeline.voiceEngine.label}"
                micButton.isEnabled = true
                highlight()
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
        pipeline.switchVoice(next) { err ->
            runOnUiThread {
                if (err == null) prefs.edit().putString(PREF_VOICE, next.name).apply()
                voiceButton.text = "Voice: ${pipeline.voiceEngine.label}"
                voiceButton.isEnabled = true
                send.isEnabled = true
            }
        }
    }

    private fun showBenchMenu() {
        if (!send.isEnabled) return
        val current = asrEngine()
        val recognizers = AsrEngine.entries.map { e ->
            val mark = if (e == current) "✓ " else ""
            val size = if (store.asr2Ready(e)) "" else " (download ${e.approxMb} MB)"
            "${mark}Recognizer: ${e.label}$size"
        }
        val items = listOf("Bench voices", "Bench recognizers on my last ${ears?.recent?.size ?: 0} utterances") + recognizers
        AlertDialog.Builder(this).setItems(items.toTypedArray()) { _, which ->
            when (which) {
                0 -> runBench { onPartial, onDone -> pipeline.benchVoice(onPartial, onDone) }
                1 -> runBench { onPartial, onDone -> pipeline.benchAsr(ears?.recent?.toList().orEmpty(), onPartial, onDone) }
                else -> {
                    val e = AsrEngine.entries[which - 2]
                    prefs.edit().putString(PREF_ASR, e.name).apply()
                    transcript.append("\n— recognizer: ${e.label} —\n")
                    if (micOn) loadSecondPass()
                }
            }
        }.show()
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
            if (micOn && pipeline.onUserSpeech(partial)) runOnUiThread { transcript.append(" [interrupted]") }
        }

        override fun onFinal(text: String, lastVoiceAt: Long, voicedMs: Int, recognizeMs: Long) {
            if (!micOn || !send.isEnabled) return
            val heard = pipeline.onUserUtterance(text, lastVoiceAt, voicedMs, recognizeMs)
            runOnUiThread {
                when (heard) {
                    is Pipeline.Heard.Ignored -> {
                        status.text = "(ignored \"$text\": ${heard.reason})"
                        ignoredLog.append("IGNORED \"$text\" (${heard.reason}, voiced ${voicedMs} ms)\n")
                    }
                    is Pipeline.Heard.Turn -> {
                        transcript.append("\nYou 🎤: $text\n${pipeline.character.name}: ")
                        liveTurn = heard.id
                    }
                }
            }
        }
    }

    override fun onDestroy() {
        ears?.release()
        if (micOn) setCallMode(false)
        super.onDestroy()
    }

    private fun selectCharacter(c: Character) {
        pipeline.select(c)
        transcript.append("\n— now talking to ${c.name} —\n")
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
        liveTurn = pipeline.say(text)
    }

    override fun onStatus(text: String) = runOnUiThread { status.text = text }

    override fun onReplyText(turn: Int, piece: String) = runOnUiThread {
        if (turn == liveTurn) transcript.append(piece)
    }

    override fun onTurnDone(turn: Int, report: String) = runOnUiThread {
        // She finished: throw away her echo tail so it can't become a fake user utterance.
        ears?.discardUtterance()
        reports.append(report).append("\n\n")
        metrics.text = pipeline.loadReport + "\n\n" + report
    }

    private companion object {
        const val PREF_VOICE = "voice_engine"
        const val REQ_MIC = 1
        const val PREF_ASR = "asr_engine"
    }
}
