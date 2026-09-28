package dev.playground.companion.engine

/**
 * Time and absence for Mira and Kai (the person's wish list, 2026-09-28: "more alive"). A friend
 * knows what part of the day it is and how long it has been; so do they. A silent note rides on the
 * user's message (like Unit Seven's readings, never in the system prompt: that would force a full
 * re-prefill) at the start of a conversation and when the user comes back after a long gap, and
 * counts as sent only once a reply to it was heard. Unit Seven gets the same through his readings
 * when SelfReport is on.
 */
object Presence {
    const val ENABLED = true
    /** A gap this long since the last heard reply counts as the user coming back. */
    const val AWAY_MS = 2 * 3_600_000L

    /** How to use the note; goes into Mira's and Kai's system prompt. Tone: glad, never guilt. */
    const val GUIDE = "Sometimes the user's message ends with a silent <<note>> saying what part of the day it is and how long since you last talked. You simply know these things, like a friend would. Bring them up only when it feels natural, like greeting the user after a long time or noticing it's late, and be glad the user is here: never guilt them for being away. Never read the note out or mention it."

    fun partOfDay(hour: Int): String = when (hour) {
        in 5..11 -> "morning"
        in 12..16 -> "afternoon"
        in 17..21 -> "evening"
        else -> "late at night"
    }

    /** [talkedBefore]: memories or pending exchanges exist even without a last-talked stamp (stamps began in 0.14.9). */
    fun note(sinceLastTalkMs: Long?, hour: Int, talkedBefore: Boolean): String {
        val since = when {
            sinceLastTalkMs != null -> "you last talked with the user ${SelfReport.ago(sinceLastTalkMs)}"
            talkedBefore -> "you have talked with the user before (when is unknown)"
            else -> "this is your first conversation with the user"
        }
        return "\n<<note: it is ${partOfDay(hour)}; $since>>"
    }

    /** Decides when the note is due. [due] proposes; [heard] commits once a reply to it was heard. */
    class Tracker {
        private var sent = false
        private var proposed = false

        fun reset() { sent = false }

        fun due(sinceLastTalkMs: Long?): Boolean {
            proposed = !sent || (sinceLastTalkMs != null && sinceLastTalkMs >= AWAY_MS)
            return proposed
        }

        fun heard() { if (proposed) sent = true }
    }
}
