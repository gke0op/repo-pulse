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

    /** Drops the first [count] pending exchanges (they are in the notes now). */
    @Synchronized fun consume(id: String, count: Int) {
        val rest = pending(id).drop(count)
        if (rest.isEmpty()) pendingFile(id).delete()
        else pendingFile(id).writeText(rest.joinToString("") { (u, r) -> "U\t$u\nR\t$r\n" })
    }
}
