package dev.playground.companion

import android.content.Context
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.Executors

/**
 * Durable record of a session: every line is appended and flushed to disk as it happens,
 * so a dead battery or a crash loses nothing. One Markdown file per app launch in
 * app-specific storage (Android/data/<pkg>/files/logs); shared from the Models… menu.
 */
class SessionLog(ctx: Context) {
    private val dir = File(ctx.getExternalFilesDir(null) ?: ctx.filesDir, "logs").apply { mkdirs() }
    val file = File(dir, "session-${stamp("yyyy-MM-dd_HH-mm-ss")}.md")
    private val io = Executors.newSingleThreadExecutor { Thread(it, "session-log") }

    init { append("# Companion session ${stamp("yyyy-MM-dd HH:mm:ss")}\n") }

    /** Appends on a background thread; each write is opened, appended and closed (flushed). */
    fun append(text: String) {
        val line = if (text.endsWith("\n")) text else text + "\n"
        io.execute { runCatching { file.appendText(line) } }
    }

    fun event(what: String) = append("\n_${stamp("HH:mm:ss")} · ${what}_\n")

    fun turn(who: String, user: String, reply: String, feelings: String) = append(
        "\n**You** (${stamp("HH:mm:ss")}): $user\n\n**$who**${if (feelings.isNotEmpty()) " [$feelings]" else ""}: " +
            reply.ifBlank { "_(cut off before a word was heard; your next words joined this message)_" } + "\n",
    )

    fun report(report: String) = append("\n```\n${report.trimEnd()}\n```\n")

    /** Whole file, for sharing. Waits for pending writes. */
    fun readAll(): String {
        io.submit {}.get()
        return runCatching { file.readText() }.getOrDefault("")
    }

    private fun stamp(pattern: String) = SimpleDateFormat(pattern, Locale.US).format(Date())
}
