package dev.playground.companion.engine

/** Makes LLM text safe to speak: drops stage directions, markdown and emoji. */
object SpeechText {
    private val stageDirection = Regex("\\*[^*]*\\*|\\([^)]*\\)")
    private val markdown = Regex("[#_`~>\\[\\]]")
    private val nonSpeech = Regex("[\\p{So}\\p{Cn}\\p{Cs}\\uFE0F\\u200D]")
    private val spaces = Regex("\\s+")

    /** *word* after another word is emphasis ("Are *you* okay?"), not an action: keep the word. */
    private val emphasis = Regex("(?<=\\w[,]? )\\*(\\w[\\w']*)\\*")

    fun clean(text: String): String =
        text.replace(emphasis, "$1")
            .replace(stageDirection, " ")
            .replace(markdown, " ")
            .replace(nonSpeech, " ")
            .replace(spaces, " ")
            .trim()

    /** True if there is anything a voice could say. */
    fun speakable(text: String) = text.any { it.isLetterOrDigit() }
}
