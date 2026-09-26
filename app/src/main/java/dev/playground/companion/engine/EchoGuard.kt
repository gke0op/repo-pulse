package dev.playground.companion.engine

/**
 * Decides whether mic text is the companion's own voice leaking back in
 * (speaker -> mic), which the platform echo canceller doesn't always remove.
 */
object EchoGuard {
    /** Needs 3+ words: short replies like "yes" are too ambiguous to call echo. */
    fun isEcho(heard: String, saidRecently: String): Boolean {
        val h = words(heard)
        if (h.size < 3) return false
        val said = words(saidRecently).toSet()
        return h.count { it in said } >= h.size * 0.6
    }

    fun words(s: String) = s.lowercase().split(Regex("[^a-z0-9']+")).filter { it.isNotEmpty() }

    /** Lone words ASR emits from noise or echo residue. "yes"/"no"/"hi" stay valid replies. */
    private val FILLERS = setOf("and", "then", "the", "a", "an", "uh", "um", "hmm", "ah", "oh", "so", "but", "i", "it", "in", "of", "to")

    /** Minimum VAD-confirmed speech for an utterance to count as the user talking. */
    const val MIN_VOICED_MS = 300

    /** Null if this looks like real speech, else a short reason it was rejected. */
    fun rejectReason(text: String, voicedMs: Int): String? {
        val w = words(text)
        return when {
            voicedMs < MIN_VOICED_MS -> "only ${voicedMs} ms of voice"
            w.size == 1 && w[0] in FILLERS -> "lone filler word"
            else -> null
        }
    }
}
