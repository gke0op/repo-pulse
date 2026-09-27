package dev.playground.companion

import dev.playground.companion.engine.AsrEngine
import dev.playground.companion.engine.LlmModel
import dev.playground.companion.engine.VoiceEngine
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

    fun voiceDir(e: VoiceEngine) = File(dir, e.dirName)
    fun voiceReady(e: VoiceEngine) = File(voiceDir(e), ".ok").exists()

    fun llmFile(m: LlmModel) = File(dir, m.fileName)
    fun llmReady(m: LlmModel) = llmFile(m).exists()

    /** Any one brain plus any one voice are needed to start; the rest download on demand. */
    fun ready() = LlmModel.entries.any(::llmReady) && VoiceEngine.entries.any(::voiceReady)

    /** progress(label, doneBytes, totalBytes) */
    fun ensure(progress: (String, Long, Long) -> Unit) {
        if (LlmModel.entries.none(::llmReady)) ensureLlm(DEFAULT_LLM, progress)
        if (VoiceEngine.entries.none(::voiceReady)) ensureVoice(DEFAULT_VOICE, progress)
    }

    fun ensureLlm(m: LlmModel, progress: (String, Long, Long) -> Unit) {
        if (!llmReady(m)) download(m.url, llmFile(m)) { d, t -> progress("Brain (${m.label})", d, t) }
    }

    val asrDir = File(dir, "asr-zipformer-en-2023-06-26-int8")
    val vadFile = File(dir, "silero_vad.onnx")
    fun earsReady() = File(asrDir, ".ok").exists() && vadFile.exists()

    /** Streaming ASR (int8 files only, ~73 MB) + Silero VAD. */
    fun ensureEars(progress: (String, Long, Long) -> Unit) {
        if (!vadFile.exists()) download(VAD_URL, vadFile) { d, t -> progress("Voice activity model", d, t) }
        if (File(asrDir, ".ok").exists()) return
        asrDir.mkdirs()
        for (name in ASR_FILES) {
            val f = File(asrDir, name)
            if (!f.exists()) download("$ASR_BASE/$name", f) { d, t -> progress("Speech recognition ($name)", d, t) }
        }
        File(asrDir, ".ok").writeText("ok")
    }

    fun asr2Dir(e: AsrEngine) = File(dir, e.dirName)
    fun asr2Ready(e: AsrEngine) = File(asr2Dir(e), ".ok").exists()

    fun ensureAsr2(e: AsrEngine, progress: (String, Long, Long) -> Unit) {
        if (asr2Ready(e)) return
        val tar = File(dir, "${e.dirName}.tar.bz2")
        download(e.url, tar) { d, t -> progress("Recognizer (${e.label})", d, t) }
        progress("Unpacking ${e.label}", 0, 0)
        untarBz2(tar, dir)
        tar.delete()
        File(asr2Dir(e), ".ok").writeText("ok")
    }

    fun ensureVoice(e: VoiceEngine, progress: (String, Long, Long) -> Unit) {
        if (voiceReady(e)) return
        val tar = File(dir, "${e.dirName}.tar.bz2")
        download(e.url, tar) { d, t -> progress("Voice (${e.label})", d, t) }
        progress("Unpacking ${e.label}", 0, 0)
        untarBz2(tar, dir)
        tar.delete()
        File(voiceDir(e), ".ok").writeText("ok")
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

    companion object {
        /** Persona eval (tools/host-test/persona_eval): strongest character voice of 5 candidates. */
        val DEFAULT_LLM = LlmModel.GEMMA3_4B

        /** Fastest measured on S24 Ultra: RTF 0.40 at 2 threads (Kokoro fp32 best: 0.53 at 6). */
        val DEFAULT_VOICE = VoiceEngine.SUPERTONIC3
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
