package dev.playground.companion

import dev.playground.companion.engine.SentenceChunker
import org.junit.Assume.assumeTrue
import org.junit.Test
import java.io.File

/**
 * Dev tool, skipped unless CHUNK_SIM_LOGS is set (a dir of phone session logs): replays every real
 * reply through the app's SentenceChunker and times it with that turn's own measurements (first
 * token, tok/s, first-chunk and total synth, audio length), then reports first audio and silence
 * inside the reply per chunking policy. Validates itself against what the phone reported.
 */
class ChunkingSimTest {
    class Turn(val reply: String, val heat: Int, val ftMs: Double, val tokS: Double, val tokens: Int,
               val s1: Double, val n1: Int, val synthTotal: Double, val chunks: Int, val audioMs: Double,
               val obsFirstAudio: Double, val obsSilence: Double)

    private fun parse(dir: File): List<Turn> = dir.listFiles { f -> f.name.startsWith("session-") }!!.sorted().flatMap { f ->
        val t = f.readText()
        Regex("""\*\*(?:Mira|Kai|Unit Seven)\*\*(?: \[[^\]\n]*\])?: ([^\n]+)\n\n```\n(TURN #[^`]*)```""").findAll(t).mapNotNull { m ->
            val reply = m.groupValues[1].trim(); val b = m.groupValues[2]
            fun g(p: String) = Regex(p).find(b)?.groupValues?.get(1)
            val fa = g("""first audio : (\d+)""")?.toDouble() ?: return@mapNotNull null
            val ft = g("""first token : (\d+)""")?.toDouble() ?: return@mapNotNull null
            val first = g("""first chunk : \d+ ms\s+"([^"]*)"""") ?: return@mapNotNull null
            Turn(reply, g("""status (\d)""")?.toInt() ?: -1, ft,
                g("""@ ([\d.]+) tok/s""")?.toDouble() ?: return@mapNotNull null, g("""LLM\s+: (\d+) tok""")?.toInt() ?: return@mapNotNull null,
                g("""first chunk synth (\d+)""")?.toDouble() ?: return@mapNotNull null, first.length,
                g("""TTS\s+: \d+ chunks, synth (\d+)""")?.toDouble() ?: return@mapNotNull null, g("""TTS\s+: (\d+) chunks""")!!.toInt(),
                g("""for (\d+) ms audio""")?.toDouble() ?: return@mapNotNull null, fa,
                (g("""total\s+: (\d+)""")?.toDouble() ?: return@mapNotNull null) - fa - (g("""for (\d+) ms audio""")!!.toDouble()))
        }.toList()
    }

    /** Returns (first audio ms, silence inside the reply ms) for [t] chunked by [make]. */
    private fun simulate(t: Turn, make: () -> SentenceChunker): Pair<Double, Double> {
        val text = t.reply.replace(Regex("""\[[^\]]*\]"""), "").replace("*", "").trim()
        if (text.isEmpty() || t.tokens == 0) return 0.0 to 0.0
        val charsPerTok = text.length.toDouble() / t.tokens
        val msPerChar = 1000.0 / (t.tokS * charsPerTok)
        // Synth model per turn: synth(n) = a + b*n, fitted to this turn's first chunk and total.
        val b = ((t.synthTotal - t.chunks * t.s1) / (text.length - t.chunks * t.n1).coerceAtLeast(1)).coerceIn(0.0, 200.0)
        val a = (t.s1 - b * t.n1).coerceAtLeast(0.0)
        val audioPerChar = t.audioMs / text.length
        val c = make(); val ready = mutableListOf<Pair<String, Double>>()
        var pos = 0
        for (piece in text.chunked(4)) { pos += piece.length; c.push(piece).forEach { ready += it to (t.ftMs + pos * msPerChar) } }
        c.flush()?.let { ready += it to (t.ftMs + text.length * msPerChar) }
        var synthEnd = 0.0; var playEnd = 0.0; var first = -1.0; var silence = 0.0
        for ((chunk, at) in ready) {
            synthEnd = maxOf(at, synthEnd) + a + b * chunk.length
            val start = maxOf(synthEnd, playEnd)
            if (first < 0) first = start else silence += start - playEnd
            playEnd = start + audioPerChar * chunk.length
        }
        return first to silence
    }

    @Test fun replay() {
        val dir = System.getenv("CHUNK_SIM_LOGS"); assumeTrue(dir != null)
        val turns = parse(File(dir!!)).filter { it.chunks > 1 }
        fun med(x: List<Double>) = x.sorted()[x.size / 2]
        val policies = linkedMapOf<String, () -> SentenceChunker>(
            "current" to { SentenceChunker() },
            "ramp: 2nd chunk may break at a clause" to { SentenceChunker(rampChunks = 1) },
            "ramp: 2nd+3rd chunk" to { SentenceChunker(rampChunks = 2) },
        )
        println("turns: ${turns.size}")
        val sim0 = turns.map { simulate(it, policies["current"]!!) }
        println("validation (current chunker): first audio sim ${med(sim0.map { it.first })} vs phone ${med(turns.map { it.obsFirstAudio })} ms; " +
            "silence sim ${med(sim0.map { it.second })} vs phone ${med(turns.map { it.obsSilence })} ms")
        for ((hot, label) in listOf(false to "cool (status 0-2)", true to "hot (status 3-4)")) {
            val ts = turns.filter { (it.heat >= 3) == hot }
            for ((name, mk) in policies) {
                val r = ts.map { simulate(it, mk) }
                println("$label n=${ts.size} | $name: first audio ${med(r.map { it.first }).toInt()} ms, silence median ${med(r.map { it.second }).toInt()} ms, p75 ${r.map { it.second }.sorted()[3 * r.size / 4].toInt()} ms")
            }
        }
    }
}
