package dev.playground.companion.engine

/**
 * Swappable brains (GGUF, Q4_K_M). Downloaded on demand; the choice is remembered.
 * Sizes are the download sizes; RAM use is roughly the same (weights are mmap'd).
 */
enum class LlmModel(val label: String, val fileName: String, val repo: String, val approxMb: Int) {
    QWEN25_1_5B("Qwen2.5 1.5B", "qwen2.5-1.5b-instruct-q4_k_m.gguf", "Qwen/Qwen2.5-1.5B-Instruct-GGUF", 1066),
    QWEN3_4B("Qwen3 4B 2507", "Qwen_Qwen3-4B-Instruct-2507-Q4_K_M.gguf", "bartowski/Qwen_Qwen3-4B-Instruct-2507-GGUF", 2382),
    GEMMA3_4B("Gemma 3 4B", "google_gemma-3-4b-it-Q4_K_M.gguf", "bartowski/google_gemma-3-4b-it-GGUF", 2374),
    LLAMA32_3B("Llama 3.2 3B", "Llama-3.2-3B-Instruct-Q4_K_M.gguf", "bartowski/Llama-3.2-3B-Instruct-GGUF", 1926),
    PHI4_MINI("Phi-4 mini", "microsoft_Phi-4-mini-instruct-Q4_K_M.gguf", "bartowski/microsoft_Phi-4-mini-instruct-GGUF", 2376);

    val url get() = "https://huggingface.co/$repo/resolve/main/$fileName"
}
