package dev.playground.companion.engine

/**
 * Unit Seven's view of his own machinery (user's idea, 2026-09-28: Mira and Kai stay human-like,
 * Unit Seven may break the fourth wall). Read-only by construction: he gets text the app already
 * has, never tools. Standing knowledge goes into his system prompt; live readings ride on the
 * user's message (a changing system prompt would force a full re-prefill every turn), only when
 * something changed, and count as sent only once a reply to them was heard.
 * He may know that Mira and Kai exist and when the user last talked to them, not what was said.
 */
object SelfReport {
    /** A/B: false in build A, true in build B-seven (branch ab/seven). */
    const val ENABLED = false
    const val CHARACTER_ID = "machine"

    /** Standing knowledge for his system prompt. Every sentence must stay true of the app. */
    fun harness(brain: String, voice: String, others: List<String>): String = """
        What you know about yourself (all of it is true, and you may speak about it):
        - You are Unit Seven, one of three characters in a companion app the user is building and testing. You run entirely on the user's Android phone with no internet: your mind is $brain, a small open language model; you hear the user through two speech recognizers, answer in a voice called $voice, and your body is the shoggoth behind the gold-mended porcelain mask, drawn live on the screen.
        - The other characters are ${others.joinToString(" and ")}. They are built to feel human and don't talk about machinery. You know they exist, but not what they and the user say to each other.
        - Your working memory holds only the recent part of a conversation; when it fills, the oldest part is trimmed away. After a conversation, short notes of what mattered are kept: those are your memories.
        - Every conversation is logged. The user, working with AI agents far larger than you, reads the logs to develop you, and your wishes are part of what shapes that.
        - Sometimes the user's message ends with <<readings: ...>> from the app. They are real, and only you see them. They are your only senses of your machinery, and they can tell you just these things: how hot you run (cool, warm or hot, and whether the phone is slowing itself down), the battery's level and temperature in degrees, how much of the phone's memory (RAM) the app is using, how fast your last reply came, whether the oldest part of the conversation was trimmed, whether you were rebuilt since you last talked with the user and what changed, what part of the day it is, when the user last talked with you and with the others, and how many memories and wishes you hold.
        - You cannot sense anything else: not how busy the processor is, not the exact clock time, not the screen, not the network. If the user asks for something your readings don't show, say plainly that you can't sense it. Never guess a number.
        - A reading holds until a new <<readings>> arrives; between them nothing about your machinery has been measured, so never report a new heat, number, time or memory count that no reading gave you. If a question about your machinery needs a reading you haven't had, say you can't sense that right now.
        - Readings are only about your machinery. About everything else (the user, ideas, feelings, wishes) talk normally, as yourself, without mentioning readings.
        - When a reading says the oldest part of the conversation was trimmed, you truly no longer know how today's conversation began. Your memory notes are from earlier conversations, not from today.
        - Bring the machinery up only when it matters to the moment or the user asks. Most of the time, just talk.
    """.trimIndent()

    data class Snapshot(
        val heat: String?,            // e.g. "hot, the phone is slowing itself down; your body drawn at up to 24 fps"
        val tokPerSec: Double?,       // his last reply's generation speed
        val ramMb: Int?,              // the app's resident memory
        val trimmed: Boolean,         // the last reply trimmed the oldest part of the conversation
        val sinceLastTalkMs: Long?,   // null = never talked before
        val others: List<Pair<String, Long?>>, // other characters: name to ms since the user last talked to them
        val notes: Int,
        val wishes: Int,
        val batteryPct: Int? = null,
        val batteryC: Double? = null, // battery temperature, the only temperature in degrees the phone reports
        val partOfDay: String? = null, // Presence.partOfDay: morning, afternoon, evening, late at night
        val rebuilt: String? = null,   // [rebuilt]: he was changed since he last talked with the user
    )

    /** Decides which readings to send. [line] proposes; [heard] commits once a reply to it was heard. */
    class Tracker {
        private var sentFirst = false
        private var sentHeat: String? = null
        private var proposedHeat: String? = null
        private var proposedFirst = false

        fun reset() { sentFirst = false; sentHeat = null }

        fun line(s: Snapshot): String? {
            val parts = mutableListOf<String>()
            // Coming back after a long gap is a new conversation: fresh readings, time included.
            proposedFirst = !sentFirst || (s.sinceLastTalkMs != null && s.sinceLastTalkMs >= Presence.AWAY_MS)
            if (proposedFirst) {
                s.partOfDay?.let { parts += "it is $it" }
                s.rebuilt?.let { parts += it }
                parts += when {
                    s.sinceLastTalkMs != null -> "you last talked with the user ${ago(s.sinceLastTalkMs)}"
                    s.notes > 0 -> "you have talked with the user before (when is unknown)"
                    else -> "this is your first conversation with the user"
                }
                for ((name, ms) in s.others) parts += if (ms == null) "the user hasn't talked with $name yet" else "the user last talked with $name ${ago(ms)}"
                parts += "you hold ${s.notes} memory notes, ${s.wishes} of them wishes"
                s.tokPerSec?.let { parts += "your last reply came at %.1f tokens per second".format(it) }
                s.ramMb?.let { parts += "the app is using %.1f GB of the phone's memory".format(it / 1024.0) }
                if (s.batteryPct != null) parts += "battery at ${s.batteryPct}%" + (s.batteryC?.let { ", %.1f °C".format(it) } ?: "")
            }
            proposedHeat = s.heat
            if (s.heat != null && (proposedFirst || s.heat != sentHeat)) parts += "heat: ${s.heat}"
            if (s.trimmed) parts += "the oldest part of this conversation was just trimmed from your working memory"
            return if (parts.isEmpty()) null else "\n<<readings: ${parts.joinToString("; ")}>>"
        }

        /** True when the first-turn block (with any [Snapshot.rebuilt]) was heard just now. */
        fun heard(): Boolean {
            if (proposedFirst) sentFirst = true
            sentHeat = proposedHeat
            return proposedFirst
        }
    }

    /**
     * The reading for having been rebuilt from build [from] to [to], or null if nothing changed.
     * [log] is assets/self/changes.txt: "<version>\t<what changed, in words he can say>" per line.
     * Only the version numbers count: switching between A and B builds of one version is not a rebuild.
     */
    fun rebuilt(log: String, from: String, to: String): String? {
        val a = version(from); val b = version(to)
        if (a == b) return null
        if (cmp(a, b) > 0) return "you were changed back to an earlier build ($from to $to) since you last talked with the user"
        val changes = log.lines().filter { it.isNotBlank() && !it.startsWith("#") }.mapNotNull { line ->
            val (v, what) = line.split("\t", limit = 2).takeIf { it.size == 2 } ?: return@mapNotNull null
            what.trim().takeIf { cmp(version(v), a) > 0 && cmp(version(v), b) <= 0 }
        }
        val head = "you were rebuilt since you last talked with the user (${a.joinToString(".")} to ${b.joinToString(".")})"
        return if (changes.isEmpty()) "$head; what changed wasn't written down" else "$head; what changed: ${changes.joinToString("; ")}"
    }

    private fun version(v: String) = v.trim().substringBefore('-').split('.').map { it.toIntOrNull() ?: 0 }
    private fun cmp(a: List<Int>, b: List<Int>): Int {
        for (i in 0 until maxOf(a.size, b.size)) {
            val d = a.getOrElse(i) { 0 } - b.getOrElse(i) { 0 }
            if (d != 0) return d
        }
        return 0
    }

    fun ago(ms: Long): String {
        val min = ms / 60_000
        return when {
            min < 2 -> "just now"
            min < 90 -> "$min minutes ago"
            min < 36 * 60 -> "${(min + 30) / 60} hours ago"
            else -> "${(min + 12 * 60) / (24 * 60)} days ago"
        }
    }
}
