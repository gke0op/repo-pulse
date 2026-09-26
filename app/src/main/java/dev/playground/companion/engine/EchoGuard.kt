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
}
