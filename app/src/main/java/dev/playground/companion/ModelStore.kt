package dev.playground.companion

import android.app.DownloadManager
import android.content.Context
import android.net.Uri
import dev.playground.companion.engine.AsrEngine
import dev.playground.companion.engine.LlmModel
import dev.playground.companion.engine.VoiceEngine
import org.apache.commons.compress.archivers.tar.TarArchiveInputStream
import org.apache.commons.compress.compressors.bzip2.BZip2CompressorInputStream
import java.io.BufferedInputStream
import java.io.File
import java.io.FileOutputStream
import java.io.IOException

/**
 * Downloads models once; after that everything runs offline.
 *
 * Downloads go through Android's DownloadManager, so they keep going with the screen off
 * or the app closed, retry on network changes, and show progress in the notification
 * shade. DownloadManager can only write to app-specific external storage, so new models
 * land there; models from older builds stay where they are (internal storage) and are
 * found in either place.
 */
class ModelStore(ctx: Context) {
    private val legacyDir = File(ctx.filesDir, "models")
    private val dir = File(ctx.getExternalFilesDir(null) ?: ctx.filesDir, "models").apply { mkdirs() }
    private val dm = ctx.getSystemService(DownloadManager::class.java)

    /** Where [name] lives: the legacy internal copy if a finished one exists, else the new location. */
    private fun place(name: String, isDir: Boolean = false): File {
        val old = File(legacyDir, name)
        val done = if (isDir) File(old, ".ok").exists() else old.exists()
        return if (done) old else File(dir, name)
    }

    fun voiceDir(e: VoiceEngine) = place(e.dirName, isDir = true)
    fun voiceReady(e: VoiceEngine) = File(voiceDir(e), ".ok").exists()

    fun llmFile(m: LlmModel) = place(m.fileName)
    fun llmReady(m: LlmModel) = llmFile(m).exists()

    /** Any one brain plus any one voice are needed to start; the rest download on demand. */
    fun ready() = LlmModel.entries.any(::llmReady) && VoiceEngine.entries.any(::voiceReady)

    /** progress(label, doneBytes, totalBytes) */
    fun ensure(progress: (String, Long, Long) -> Unit) {
        if (LlmModel.entries.none(::llmReady)) ensureLlm(DEFAULT_LLM, progress)
        if (VoiceEngine.entries.none(::voiceReady)) ensureVoice(DEFAULT_VOICE, progress)
    }

    fun ensureLlm(m: LlmModel, progress: (String, Long, Long) -> Unit) {
        if (!llmReady(m)) download(m.url, llmFile(m), "Brain (${m.label})", progress)
    }

    val asrDir get() = place("asr-zipformer-en-2023-06-26-int8", isDir = true)
    val vadFile get() = place("silero_vad.onnx")
    fun earsReady() = File(asrDir, ".ok").exists() && vadFile.exists()

    /** Streaming ASR (int8 files only, ~73 MB) + Silero VAD. */
    fun ensureEars(progress: (String, Long, Long) -> Unit) {
        if (!vadFile.exists()) download(VAD_URL, vadFile, "Voice activity model", progress)
        val asr = asrDir
        if (File(asr, ".ok").exists()) return
        asr.mkdirs()
        for (name in ASR_FILES) {
            val f = File(asr, name)
            if (!f.exists()) download("$ASR_BASE/$name", f, "Speech recognition", progress)
        }
        File(asr, ".ok").writeText("ok")
    }

    /** VRM humans (Mira, Kai), served to the avatar page from here. Not bundled: they'd double the APK. */
    /** Kept under the pinned commit, so bumping AVATAR_BASE re-downloads instead of reusing stale files. */
    fun avatarFile(name: String) = place("avatar/$AVATAR_REV/$name")
    fun avatarsReady() = AVATAR_MODELS.all { avatarFile(it).exists() }
    fun ensureAvatars(progress: (String, Long, Long) -> Unit) {
        for (name in AVATAR_MODELS) {
            if (!avatarFile(name).exists()) download("$AVATAR_BASE/$name", avatarFile(name), "Avatar ($name)", progress)
        }
    }

    fun asr2Dir(e: AsrEngine) = place(e.dirName, isDir = true)
    fun asr2Ready(e: AsrEngine) = File(asr2Dir(e), ".ok").exists()

    fun ensureAsr2(e: AsrEngine, progress: (String, Long, Long) -> Unit) {
        if (!asr2Ready(e)) fetchTarball(e.url, e.dirName, "Recognizer (${e.label})", progress)
    }

    fun ensureVoice(e: VoiceEngine, progress: (String, Long, Long) -> Unit) {
        if (!voiceReady(e)) fetchTarball(e.url, e.dirName, "Voice (${e.label})", progress)
    }

    /** Downloads a .tar.bz2 and unpacks it into [dir]; `.ok` marks a complete unpack. */
    private fun fetchTarball(url: String, dirName: String, label: String, progress: (String, Long, Long) -> Unit) {
        val tar = File(dir, "$dirName.tar.bz2")
        download(url, tar, label, progress) // returns at once if a finished tarball is already here
        progress("Unpacking $label", 0, 0)
        untarBz2(tar, dir)
        File(dir, "$dirName/.ok").writeText("ok")
        tar.delete()
    }

    /**
     * Blocks until [dest] is fully downloaded. Re-attaches to a DownloadManager job already
     * running for the same file (e.g. started before the app was closed) instead of restarting.
     */
    private fun download(url: String, dest: File, label: String, progress: (String, Long, Long) -> Unit) {
        if (dest.exists()) return
        dest.parentFile?.mkdirs()
        val tmp = File(dest.path + ".download")
        val id = findJob(url, tmp) ?: run {
            tmp.delete() // DownloadManager refuses to overwrite a leftover partial file
            dm.enqueue(
                DownloadManager.Request(Uri.parse(url))
                    .setDestinationUri(Uri.fromFile(tmp))
                    .setTitle("Companion: $label")
                    .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE)
                    .setAllowedOverMetered(true)
                    .setAllowedOverRoaming(true),
            )
        }
        while (true) {
            val job = query(id) ?: throw IOException("download of $label was cancelled")
            when (job.status) {
                DownloadManager.STATUS_SUCCESSFUL -> {
                    if (!tmp.renameTo(dest)) throw IOException("could not move $label into place")
                    return
                }
                DownloadManager.STATUS_FAILED -> {
                    dm.remove(id)
                    throw IOException("download of $label failed (reason ${job.reason}); tap again to retry")
                }
                DownloadManager.STATUS_PAUSED -> progress("$label: paused (${pauseReason(job.reason)})", job.done, job.total)
                else -> progress(label, job.done, job.total)
            }
            Thread.sleep(500)
        }
    }

    private class Job(val status: Int, val reason: Int, val done: Long, val total: Long)

    private fun query(id: Long): Job? =
        dm.query(DownloadManager.Query().setFilterById(id)).use { c ->
            if (!c.moveToFirst()) return null
            Job(
                c.getInt(c.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS)),
                c.getInt(c.getColumnIndexOrThrow(DownloadManager.COLUMN_REASON)),
                c.getLong(c.getColumnIndexOrThrow(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR)),
                c.getLong(c.getColumnIndexOrThrow(DownloadManager.COLUMN_TOTAL_SIZE_BYTES)),
            )
        }

    /** A live (not failed) job for this URL writing to [tmp], if one exists. */
    private fun findJob(url: String, tmp: File): Long? =
        dm.query(DownloadManager.Query()).use { c ->
            while (c.moveToNext()) {
                val uri = c.getString(c.getColumnIndexOrThrow(DownloadManager.COLUMN_URI))
                val local = c.getString(c.getColumnIndexOrThrow(DownloadManager.COLUMN_LOCAL_URI))
                val status = c.getInt(c.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS))
                if (uri == url && local != null && Uri.parse(local).path == tmp.path && status != DownloadManager.STATUS_FAILED) {
                    return c.getLong(c.getColumnIndexOrThrow(DownloadManager.COLUMN_ID))
                }
            }
            null
        }

    private fun pauseReason(r: Int) = when (r) {
        DownloadManager.PAUSED_WAITING_FOR_NETWORK -> "waiting for network"
        DownloadManager.PAUSED_WAITING_TO_RETRY -> "retrying soon"
        DownloadManager.PAUSED_QUEUED_FOR_WIFI -> "waiting for Wi-Fi"
        else -> "paused"
    }

    private fun untarBz2(archive: File, into: File) {
        TarArchiveInputStream(BZip2CompressorInputStream(BufferedInputStream(archive.inputStream(), 1 shl 16))).use { tar ->
            while (true) {
                val e = tar.nextEntry ?: break
                val out = File(into, e.name)
                if (!out.canonicalPath.startsWith(into.canonicalPath)) continue
                if (e.isDirectory) { out.mkdirs(); continue }
                out.parentFile?.mkdirs()
                FileOutputStream(out).use { tar.copyTo(it) }
            }
        }
    }

    companion object {
        /** Persona eval (tools/host-test/persona_eval): strongest character voice of 5 candidates. */
        val DEFAULT_LLM = LlmModel.GEMMA3_4B

        /** Fastest measured on S24 Ultra: RTF 0.40 at 2 threads (Kokoro fp32 best: 0.53 at 6). */
        val DEFAULT_VOICE = VoiceEngine.SUPERTONIC3
        /** Pinned to the commit that added them, so a download can never change under us. */
        private const val AVATAR_COMMIT = "fd577571b4b1921bef768d3061f5d085fa60a8ff"
        private const val AVATAR_REV = "fd57757"
        private const val AVATAR_BASE =
            "https://raw.githubusercontent.com/gke0op/repo-pulse/$AVATAR_COMMIT/models/avatar"
        val AVATAR_MODELS = listOf("mira.vrm", "kai.vrm")
        private const val VAD_URL = "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/silero_vad.onnx"
        private const val ASR_BASE = "https://huggingface.co/csukuangfj/sherpa-onnx-streaming-zipformer-en-2023-06-26/resolve/main"
        private val ASR_FILES = listOf(
            "encoder-epoch-99-avg-1-chunk-16-left-128.int8.onnx",
            "decoder-epoch-99-avg-1-chunk-16-left-128.int8.onnx",
            "joiner-epoch-99-avg-1-chunk-16-left-128.int8.onnx",
            "tokens.txt",
        )
    }
}
