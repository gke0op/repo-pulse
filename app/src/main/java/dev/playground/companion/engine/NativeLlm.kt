package dev.playground.companion.engine

/** Thin binding to app/src/main/cpp/llm_jni.cpp. One engine per process; call from one thread. */
object NativeLlm {
    fun interface PieceSink { fun onPiece(utf8: ByteArray): Boolean }

    class Stats(v: DoubleArray) {
        val promptTokens = v[0].toInt()
        val prefillMs = v[1]
        val genTokens = v[2].toInt()
        val genMs = v[3]
        val rebuilt = v[4] != 0.0
        val cancelled = v[5] != 0.0
        /** On a history trim: cached tokens kept by shifting the KV cache instead of re-decoding. */
        val shiftReused = v[6].toInt()
        /** Names this reply for [retractLastReply]. */
        val replyId = v[7].toLong()
        val tokPerSec get() = if (genMs > 0) genTokens * 1000.0 / genMs else 0.0
    }

    init { System.loadLibrary("companion") }

    external fun init(nativeLibDir: String)
    /** [nThreadsBatch]: threads for prompt processing, which scales with cores; generation uses [nThreads]. */
    external fun load(path: String, nCtx: Int, nThreads: Int, nThreadsBatch: Int): Boolean
    external fun setSystem(prompt: String): Boolean
    private external fun reply(user: String, maxTokens: Int, prefix: String, sink: PieceSink): DoubleArray
    external fun cancel()
    /**
     * Forget reply [replyId] if it is still the latest (nobody heard it). [dropUser]: also undo its
     * user text (a cancelled early start: the final utterance re-sends all of it).
     */
    external fun retractLastReply(replyId: Long, dropUser: Boolean)
    /** Voice first: pause generation between tokens (bounded to 1.5 s) so the first chunk synthesizes alone. */
    external fun hold(on: Boolean)
    /** One-off completion in a scratch context; the conversation is untouched. Null if it failed or was cancelled. */
    fun completeIsolated(system: String, user: String, maxTokens: Int, nCtx: Int): String? =
        completeIsolatedBytes(system, user, maxTokens, nCtx)?.let { String(it, Charsets.UTF_8) }
    private external fun completeIsolatedBytes(system: String, user: String, maxTokens: Int, nCtx: Int): ByteArray?
    external fun unload()
    external fun systemInfo(): String

    /** [prefix] starts the reply for the model (prefill); it is streamed back as the first piece. */
    fun replyStreaming(user: String, maxTokens: Int, prefix: String, sink: PieceSink) =
        Stats(reply(user, maxTokens, prefix, sink))
}
