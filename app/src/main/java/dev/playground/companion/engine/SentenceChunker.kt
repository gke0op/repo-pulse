package dev.playground.companion.engine

/**
 * Turns a stream of LLM text pieces into speakable chunks as early as possible.
 *
 * The first chunk of a reply may break at a clause (", ; :") once it has a few words,
 * so the voice starts while the model is still writing. Later chunks break at sentence
 * ends, or at a clause once they get long.
 */
class SentenceChunker(
    private val firstClauseMinWords: Int = 4,
    private val longChunkChars: Int = 140,
) {
    private val buf = StringBuilder()
    private var emitted = 0

    fun push(piece: String): List<String> {
        buf.append(piece)
        val out = mutableListOf<String>()
        while (true) {
            val cut = findCut() ?: break
            val chunk = buf.substring(0, cut).trim()
            buf.delete(0, cut)
            if (chunk.isNotEmpty()) { out += chunk; emitted++ }
        }
        return out
    }

    fun flush(): String? {
        val rest = buf.toString().trim()
        buf.setLength(0)
        return rest.ifEmpty { null }?.also { emitted++ }
    }

    fun reset() { buf.setLength(0); emitted = 0 }

    /** Index just past a confirmed boundary, or null. A boundary is only confirmed by the whitespace after it. */
    private fun findCut(): Int? {
        val clauseCuts = mutableListOf<Int>()
        for (i in 0 until buf.length - 1) {
            val c = buf[i]
            val next = buf[i + 1]
            if (c == '\n') return i + 1
            if (!next.isWhitespace()) continue
            when {
                c in SENTENCE_END || (c in CLOSERS && i > 0 && buf[i - 1] in SENTENCE_END) ->
                    if (!endsWithAbbreviation(i)) return i + 1
                c in CLAUSE -> clauseCuts += i + 1
            }
        }
        if (emitted == 0) return clauseCuts.firstOrNull { wordCount(buf.substring(0, it)) >= firstClauseMinWords }
        if (buf.length >= longChunkChars) return clauseCuts.lastOrNull()
        return null
    }

    private fun endsWithAbbreviation(dotIndex: Int): Boolean {
        if (buf[dotIndex] != '.') return false
        var start = dotIndex
        while (start > 0 && !buf[start - 1].isWhitespace()) start--
        val word = buf.substring(start, dotIndex + 1).lowercase()
        return word in ABBREVIATIONS || (word.length == 2 && word[0].isLetter()) // "A." initials
    }

    private fun wordCount(s: String) = s.trim().split(Regex("\\s+")).count { it.isNotEmpty() }

    private companion object {
        val SENTENCE_END = setOf('.', '!', '?', '…')
        val CLAUSE = setOf(',', ';', ':', '—')
        val CLOSERS = setOf('"', '\'', ')', '”', '’')
        val ABBREVIATIONS = setOf("mr.", "mrs.", "ms.", "dr.", "st.", "vs.", "e.g.", "i.e.", "etc.", "jr.", "sr.")
    }
}
