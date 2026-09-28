package dev.playground.companion.engine

/**
 * Keeps replies conversational deep into a long talk, without losing poems and stories. Replaying a
 * real 95-line session through the engine (tools/host-test/drift_eval, Gemma 3 4B), median reply
 * tokens by quarter:
 *   no reminder                              26 | 43 | 59 | 78  (the phone saw 26 -> 72)
 *   brevity line in the system prompt        40 | 59 | 68 | 84  (worse)
 *   short reminder on every user message     31 | 31 | 35 | 36  but asked-for poems never came
 *   ...skipped on long-form requests         29 | 21 | 28 | 36  still no poems (she copies her brevity)
 *   short reminder + "say it in full" on     30 | 26 | 34 | 45  and all 6 poem requests got a poem
 *   long-form requests (this)
 * Long replies are also what make a hot phone stall mid-reply (the voice can't keep up).
 */
object ReplyLength {
    /** On since 0.15.3 (B-all round: short replies, a requested long answer still came in full); null turns it off. */
    val REMINDER: String? = "\n(Out loud: one to three short sentences.)"
    val LONG_REMINDER: String? = "\n(Out loud: this time say the whole thing now, in full, no preamble.)"
    private val LONG_FORM = Regex("""\b(poems?|song|sing|story|stories|lyrics|write|longer|tell me more|explain)\b""", RegexOption.IGNORE_CASE)

    /** What the brain is sent for [userText]; the transcript and memory keep the plain text. */
    fun framed(userText: String, reminder: String? = REMINDER, longReminder: String? = LONG_REMINDER): String = when {
        reminder == null -> userText
        LONG_FORM.containsMatchIn(userText) -> userText + (longReminder ?: "")
        else -> userText + reminder
    }
}
