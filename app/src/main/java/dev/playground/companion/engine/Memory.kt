package dev.playground.companion.engine

import java.io.File

/**
 * Long-term memory, per character: a few short tagged notes that survive restarts and go into the
 * character's system prompt. The brain only proposes new lines from a conversation (the prompt is
 * assets/memory/distill.txt); merging, de-duplication and the caps are done here, because a 4B
 * model rewriting a whole list copies examples and loops (measured on Gemma 3 4B, host).
 */
object Memory {
    enum class Tag(val cap: Int) { YOU(8), WISH(5), US(6) }
    data class Note(val tag: Tag, val text: String) {
        override fun toString() = "${tag.name.lowercase()}: $text"
    }

    private val LINE = Regex("""^\W*(you|wish|us)\s*:\s*(.+)$""", RegexOption.IGNORE_CASE)

    /** Tagged lines from the brain's output (or a notes file); everything else is ignored. */
    fun parse(text: String): List<Note> = text.lines().mapNotNull { line ->
        val m = LINE.find(line.trim()) ?: return@mapNotNull null
        val body = m.groupValues[2].replace("*", "").trim().replace(Regex("""([.!?]["”'])\.$"""), "$1")
        if (body.isEmpty()) return@mapNotNull null // "you: **" would crash body.last() (review 2026-09-28)
        val text = if (body.last() in ".!?\"”'") body else "$body."
        if (words(body).size < 3) null else Note(Tag.valueOf(m.groupValues[1].uppercase()), text)
    }

    /** New notes win over old ones that say nearly the same thing; each tag keeps its most recent [Tag.cap]. */
    fun merge(old: List<Note>, new: List<Note>): List<Note> {
        val out = old.toMutableList()
        for (n in new) {
            out.removeAll { it.tag == n.tag && similar(it.text, n.text) }
            out += n
        }
        return Tag.entries.flatMap { t -> out.filter { it.tag == t }.takeLast(t.cap) }
    }

    fun similar(a: String, b: String): Boolean {
        val x = words(a).toSet(); val y = words(b).toSet()
        if (x.isEmpty() || y.isEmpty()) return false
        return x.intersect(y).size.toDouble() / minOf(x.size, y.size) >= 0.6
    }

    private val STOP = setOf("the", "a", "an", "to", "of", "and", "is", "are", "was", "user", "user's", "their", "they", "it", "in", "on", "for", "with", "that", "this")
    private fun words(s: String) = s.lowercase().split(Regex("[^a-z0-9']+")).filter { it.isNotEmpty() && it !in STOP }

    /** The system-prompt block; empty when there is nothing to remember. */
    fun promptBlock(notes: List<Note>): String = if (notes.isEmpty()) "" else buildString {
        // Without the "only these" rule, notes made Gemma invent the rest (host recall_eval: a dog
        // named Pip, lemon poppyseed muffins, the user's job taken from a friend's note).
        appendLine("Your memories of earlier conversations with the user are below. They are the only things you remember from before.")
        appendLine("If the user asks about something that is not written here, you don't remember it: say so honestly and ask them to remind you. Never make up names, pets, places, songs, food or plans, and don't mix up the user with people they mentioned.")
        appendLine("Many memories are only general, like that you bake together or share music: then you don't know the details (which recipe, which song), so ask instead of guessing.")
        appendLine("Bring a memory up only when it fits; never recite the list.")
        notes.forEach { appendLine("- $it") }
    }.trimEnd()

    /**
     * The wish log (the person's idea, 2026-09-28: develop them through their own wishes): every wish
     * a character ever voiced, append-only, while the notes keep only the latest [Tag.WISH] cap.
     * [at] is when it was logged (epoch ms), 0 for wishes from before the log existed.
     */
    data class Wish(val at: Long, val text: String)

    /** Whether the wish log goes into the prompt (its oldest wishes that left the notes). */
    const val WISH_LOG_IN_PROMPT = true

    /** [wishes] that aren't in [logged] yet (nor repeated among themselves). */
    fun newWishes(logged: List<Wish>, wishes: List<Note>): List<Note> {
        val seen = logged.map { it.text }.toMutableList()
        return wishes.filter { n -> n.tag == Tag.WISH && seen.none { similar(it, n.text) }.also { if (it) seen += n.text } }
    }

    /** The oldest [max] logged wishes that left the notes, word for word; empty when there are none. */
    fun wishLogBlock(log: List<Wish>, notes: List<Note>, now: Long, max: Int = 3): String {
        val old = log.filter { w -> notes.none { it.tag == Tag.WISH && similar(it.text, w.text) } }.take(max)
        if (old.isEmpty()) return ""
        return buildString {
            appendLine("Older wishes you once had, from your wish log. Only these words are known about them: never add details. You may wonder aloud whether they still matter to you or came true.")
            old.forEach { w -> appendLine("- " + (if (w.at > 0) SelfReport.ago(now - w.at) + ": " else "some time ago: ") + w.text) }
        }.trimEnd()
    }

    /** Oldest-first transcript text, cut into pieces of at most [maxChars] (whole exchanges). */
    fun chunks(exchanges: List<Pair<String, String>>, name: String, maxChars: Int = 6000): List<Pair<String, Int>> {
        val out = mutableListOf<Pair<String, Int>>()
        val sb = StringBuilder(); var n = 0
        for ((u, r) in exchanges) {
            val e = "User: $u\n$name: $r\n"
            if (sb.isNotEmpty() && sb.length + e.length > maxChars) { out += sb.toString() to n; sb.clear(); n = 0 }
            sb.append(e); n++
        }
        if (sb.isNotEmpty()) out += sb.toString() to n
        return out
    }

    fun fill(template: String, name: String, notes: List<Note>, conversation: String) = template
        .replace("{name}", name)
        .replace("{notes}", if (notes.isEmpty()) "(none yet)" else notes.joinToString("\n"))
        .replace("{conversation}", conversation)
}

/** Files per character id: <id>.notes.txt (the memory) and <id>.pending.txt (exchanges not distilled yet). */
class MemoryStore(private val dir: File) {
    init { dir.mkdirs() }
    private fun notesFile(id: String) = File(dir, "$id.notes.txt")
    private fun pendingFile(id: String) = File(dir, "$id.pending.txt")

    @Synchronized fun notes(id: String): List<Memory.Note> = notesFile(id).takeIf { it.exists() }?.let { Memory.parse(it.readText()) }.orEmpty()
    @Synchronized fun saveNotes(id: String, notes: List<Memory.Note>) = notesFile(id).writeText(notes.joinToString("\n", postfix = "\n"))

    @Synchronized fun addExchange(id: String, user: String, reply: String) {
        val u = user.replace(Regex("\\s+"), " ").trim(); val r = reply.replace(Regex("\\s+"), " ").trim()
        if (u.isNotEmpty() && r.isNotEmpty()) pendingFile(id).appendText("U\t$u\nR\t$r\n")
    }

    @Synchronized fun pending(id: String): List<Pair<String, String>> {
        val f = pendingFile(id); if (!f.exists()) return emptyList()
        val lines = f.readLines()
        return (0 until lines.size - 1 step 2).mapNotNull { i ->
            val u = lines[i]; val r = lines[i + 1]
            if (u.startsWith("U\t") && r.startsWith("R\t")) u.substring(2) to r.substring(2) else null
        }
    }

    /** When the user last heard a reply from character [id] (epoch ms), or null. */
    @Synchronized fun lastTalked(id: String): Long? = File(dir, "$id.last").takeIf { it.exists() }?.readText()?.trim()?.toLongOrNull()
    @Synchronized fun touch(id: String, at: Long = System.currentTimeMillis()) = File(dir, "$id.last").writeText(at.toString())

    /** The wish log, oldest first. The first read seeds it with the wishes already in the notes (date unknown). */
    @Synchronized fun wishLog(id: String): List<Memory.Wish> {
        val f = File(dir, "$id.wishes.log")
        if (!f.exists()) {
            val seed = notes(id).filter { it.tag == Memory.Tag.WISH }
            if (seed.isEmpty()) return emptyList()
            f.writeText(seed.joinToString("") { "0\t${it.text}\n" })
        }
        return f.readLines().mapNotNull { line ->
            val (at, text) = line.split('\t', limit = 2).takeIf { it.size == 2 } ?: return@mapNotNull null
            Memory.Wish(at.toLongOrNull() ?: 0L, text)
        }
    }

    /** Appends the wishes among [notes] that aren't logged yet; never rewrites the log. */
    @Synchronized fun logWishes(id: String, notes: List<Memory.Note>, at: Long = System.currentTimeMillis()): List<Memory.Note> {
        val fresh = Memory.newWishes(wishLog(id), notes)
        if (fresh.isNotEmpty()) File(dir, "$id.wishes.log").appendText(fresh.joinToString("") { "$at\t${it.text}\n" })
        return fresh
    }

    /** The app build character [id] last told the user about (Unit Seven's rebuilt reading), or null. */
    @Synchronized fun build(id: String): String? = File(dir, "$id.build").takeIf { it.exists() }?.readText()?.trim()?.takeIf { it.isNotEmpty() }
    @Synchronized fun setBuild(id: String, version: String) = File(dir, "$id.build").writeText(version)

    /** Drops the first [count] pending exchanges (they are in the notes now). */
    @Synchronized fun consume(id: String, count: Int) {
        val rest = pending(id).drop(count)
        if (rest.isEmpty()) pendingFile(id).delete()
        else pendingFile(id).writeText(rest.joinToString("") { (u, r) -> "U\t$u\nR\t$r\n" })
    }
}
