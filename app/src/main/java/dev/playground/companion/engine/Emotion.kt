package dev.playground.companion.engine

/**
 * What the character feels, as tagged by the brain at the start of a reply ("[happy] ...")
 * and before any sentence where the feeling changes. Drives the avatar; never spoken.
 */
enum class Emotion {
    CALM, HAPPY, SAD, ANGRY, SURPRISED, CURIOUS, TENDER;

    val tag get() = name.lowercase()

    companion object {
        /**
         * Tags models actually produce, mapped onto our seven. Prefilled with "[", Llama 3.2
         * invented Relieved/Sympathetic/Defensive/Grateful/Excited/Concerned/Soft.
         */
        private val SYNONYMS = mapOf(
            "neutral" to CALM, "relieved" to CALM, "content" to CALM, "relaxed" to CALM, "serene" to CALM,
            "calm" to CALM, "peaceful" to CALM,
            "excited" to HAPPY, "amused" to HAPPY, "playful" to HAPPY, "joyful" to HAPPY, "cheerful" to HAPPY,
            "proud" to HAPPY, "glad" to HAPPY, "delighted" to HAPPY, "happy" to HAPPY, "laughing" to HAPPY,
            "worried" to SAD, "lonely" to SAD, "melancholy" to SAD, "hurt" to SAD, "disappointed" to SAD,
            "sad" to SAD, "gloomy" to SAD,
            "defensive" to ANGRY, "frustrated" to ANGRY, "annoyed" to ANGRY, "irritated" to ANGRY, "angry" to ANGRY,
            "shocked" to SURPRISED, "startled" to SURPRISED, "amazed" to SURPRISED, "nervous" to SURPRISED,
            "surprised" to SURPRISED,
            "interested" to CURIOUS, "thoughtful" to CURIOUS, "intrigued" to CURIOUS, "confused" to CURIOUS,
            "puzzled" to CURIOUS, "curious" to CURIOUS, "analytical" to CURIOUS,
            "sympathetic" to TENDER, "grateful" to TENDER, "soft" to TENDER, "concerned" to TENDER, "warm" to TENDER,
            "fond" to TENDER, "loving" to TENDER, "caring" to TENDER, "affectionate" to TENDER, "tender" to TENDER,
            "gentle" to TENDER, "compassionate" to TENDER, "touched" to TENDER,
        )

        fun fromWord(word: String): Emotion? = SYNONYMS[word.trim().lowercase()]
    }
}

/**
 * Splits streamed LLM text into spoken text and emotion tags, even when a tag arrives in
 * pieces ("[Hap" + "py] Oh"). Any short bracketed word is treated as a tag and never
 * reaches the voice or transcript; unknown words yield a tag with a null emotion.
 */
class EmotionTagStream {
    sealed class Part {
        data class Text(val text: String) : Part()
        data class Tag(val emotion: Emotion?, val raw: String) : Part()
    }

    private val held = StringBuilder()   // an open "[..." we can't classify yet

    fun push(piece: String): List<Part> {
        val out = mutableListOf<Part>()
        val text = StringBuilder()
        fun emitText() { if (text.isNotEmpty()) { out += Part.Text(text.toString()); text.setLength(0) } }

        for (c in piece) {
            if (held.isEmpty()) {
                if (c == '[') { emitText(); held.append(c) } else text.append(c)
                continue
            }
            held.append(c)
            when {
                c == ']' -> {
                    val word = held.substring(1, held.length - 1)
                    if (TAG_WORD.matches(word)) out += Part.Tag(Emotion.fromWord(word), word)
                    else text.append(held)
                    held.setLength(0)
                }
                held.length > MAX_TAG || !(c.isLetter() || c == ' ' || c == '-') -> {
                    text.append(held)                            // not a tag after all: speak it
                    held.setLength(0)
                }
            }
        }
        emitText()
        return out
    }

    /** End of reply: an unterminated "[..." is just text. */
    fun flush(): String? = held.toString().ifEmpty { null }.also { held.setLength(0) }

    private companion object {
        const val MAX_TAG = 24
        val TAG_WORD = Regex("[A-Za-z][A-Za-z -]{0,20}")
    }
}
