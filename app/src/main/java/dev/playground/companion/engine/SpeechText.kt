package dev.playground.companion.engine

/** Makes LLM text safe to speak: drops stage directions, markdown and emoji. */
object SpeechText {
    /**
     * `*...*` is almost always emphasis, not an action: in the 2026-09-28 phone logs 40 of 43 starred
     * spans were one emphasized word ("Not *just* water", "*that’s* a thought") and the other 3 were
     * Unit Seven's in-character "*Processing…*". The old rule kept only a word right after another
     * word, so emphasis after a dash, with a curly apostrophe or at the start of a speech chunk went
     * silent. Now the words are kept and only spans that read as actions are dropped.
     */
    private val action = Regex(
        """\*\s*(?:(?:a|an|with|one)\s+)?(?:(?:small|soft|quiet|little|thoughtful|brief|long|slight|gentle|deep|nervous|warm),?\s+)*""" +
            """(?:pause|pauses|pausing|laugh|laughs|laughing|sigh|sighs|sighing|smile|smiles|smiling|giggle|giggles|chuckle|chuckles|""" +
            """whisper|whispers|grin|grins|nod|nods|wink|winks|blush|blushes|lean|leans|look|looks|tilt|tilts|clears|shrug|shrugs|beat)\b[^*]*\*""",
        RegexOption.IGNORE_CASE,
    )
    // (asides), and any [bracketed] text the emotion parser let through: a stray tag or "[Mira begins to recite]".
    private val aside = Regex("""\([^)]*\)|\[[^\]]{1,80}\]""")
    private val markdown = Regex("[#_`~>*\\[\\]]")
    private val nonSpeech = Regex("[\\p{So}\\p{Cn}\\p{Cs}\\uFE0F\\u200D]")
    private val spaces = Regex("\\s+")

    fun clean(text: String): String =
        text.replace(action, " ")
            .replace(aside, " ")
            .replace(markdown, " ")
            .replace(nonSpeech, " ")
            .replace(spaces, " ")
            .trim()

    /** True if there is anything a voice could say. */
    fun speakable(text: String) = text.any { it.isLetterOrDigit() }
}
