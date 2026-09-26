package dev.playground.companion

import org.apache.commons.compress.archivers.tar.TarArchiveInputStream
import org.apache.commons.compress.compressors.bzip2.BZip2CompressorInputStream
import java.io.BufferedInputStream
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL

/** Downloads models once into app storage. After that everything runs offline. */
class ModelStore(root: File) {
    private val dir = File(root, "models").apply { mkdirs() }

    val llmFile = File(dir, "qwen2.5-1.5b-instruct-q4_k_m.gguf")
    val voiceDir = File(dir, "kokoro-int8-en-v0_19")

    fun ready() = llmFile.exists() && File(voiceDir, ".ok").exists()

    /** progress(label, doneBytes, totalBytes) */
    fun ensure(progress: (String, Long, Long) -> Unit) {
        if (!llmFile.exists()) download(LLM_URL, llmFile) { d, t -> progress("LLM (Qwen2.5 1.5B)", d, t) }
        if (!File(voiceDir, ".ok").exists()) {
            val tar = File(dir, "kokoro.tar.bz2")
            download(VOICE_URL, tar) { d, t -> progress("Voice (Kokoro)", d, t) }
            progress("Unpacking voice", 0, 0)
            untarBz2(tar, dir)
            tar.delete()
            File(voiceDir, ".ok").writeText("ok")
        }
    }

    private fun download(url: String, dest: File, progress: (Long, Long) -> Unit) {
        val part = File(dest.path + ".part")
        var have = if (part.exists()) part.length() else 0L
        var conn = open(url, have)
        // Follow redirects manually so the Range header survives (HF redirects to a CDN).
        var hops = 0
        while (conn.responseCode in 300..399 && hops++ < 8) {
            val next = URL(URL(url), conn.getHeaderField("Location")).toString()
            conn.disconnect()
            conn = open(next, have)
        }
        if (conn.responseCode == 200) have = 0L // server ignored Range: restart
        else if (conn.responseCode != 206) throw IOException("HTTP ${conn.responseCode} for $url")
        val total = have + conn.contentLengthLong
        conn.inputStream.use { input ->
            FileOutputStream(part, have > 0).use { out ->
                val buf = ByteArray(1 shl 16)
                var done = have
                var lastReport = 0L
                while (true) {
                    val n = input.read(buf)
                    if (n < 0) break
                    out.write(buf, 0, n)
                    done += n
                    if (done - lastReport > (1 shl 20)) { progress(done, total); lastReport = done }
                }
            }
        }
        if (!part.renameTo(dest)) throw IOException("rename failed for $dest")
    }

    private fun open(url: String, from: Long) = (URL(url).openConnection() as HttpURLConnection).apply {
        instanceFollowRedirects = false
        connectTimeout = 20_000
        readTimeout = 60_000
        if (from > 0) setRequestProperty("Range", "bytes=$from-")
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

    private companion object {
        const val LLM_URL =
            "https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/qwen2.5-1.5b-instruct-q4_k_m.gguf"
        const val VOICE_URL =
            "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/kokoro-int8-en-v0_19.tar.bz2"
    }
}
