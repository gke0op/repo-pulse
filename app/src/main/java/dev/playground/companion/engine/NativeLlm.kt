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
        val tokPerSec get() = if (genMs > 0) genTokens * 1000.0 / genMs else 0.0
    }

    init { System.loadLibrary("companion") }

    external fun init(nativeLibDir: String)
    external fun load(path: String, nCtx: Int, nThreads: Int): Boolean
    external fun setSystem(prompt: String): Boolean
    private external fun reply(user: String, maxTokens: Int, sink: PieceSink): DoubleArray
    external fun cancel()
    external fun unload()
    external fun systemInfo(): String

    fun replyStreaming(user: String, maxTokens: Int, sink: PieceSink) = Stats(reply(user, maxTokens, sink))
}
