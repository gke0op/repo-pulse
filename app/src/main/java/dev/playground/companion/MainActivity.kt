package dev.playground.companion

import android.app.Activity
import android.content.ClipData
import android.content.ClipboardManager
import android.graphics.Color
import android.graphics.Typeface
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.view.inputmethod.EditorInfo
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
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
    private val charButtons = mutableListOf<Button>()
    private var liveTurn = -1
    private val reports = StringBuilder()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        store = ModelStore(filesDir)
        pipeline = Pipeline(applicationContext, store, this)
        setContentView(buildUi())
        if (store.ready()) startPipeline() else showDownload()
    }

    private fun buildUi(): View {
        val pad = (12 * resources.displayMetrics.density).toInt()
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(pad, pad * 3, pad, pad)
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
            text = "Download models (~1.2 GB, once)"
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

        root.addView(Button(this).apply {
            text = "Copy report"
            setOnClickListener {
                val text = pipeline.loadReport + "\n\n" + reports
                (getSystemService(CLIPBOARD_SERVICE) as ClipboardManager).setPrimaryClip(ClipData.newPlainText("report", text))
                Toast.makeText(this@MainActivity, "Report copied", Toast.LENGTH_SHORT).show()
            }
        })
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
                highlight()
            }
        }
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
        reports.append(report).append("\n\n")
        metrics.text = pipeline.loadReport + "\n\n" + report
    }
}
