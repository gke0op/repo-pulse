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

    /**
     * Returns (first audio ms, silence inside the reply ms) for [t] chunked by [make]. Synth model:
     * Supertonic's shape on the Mac (fixed ~260 ms + 2.6 ms/char alone), scaled per turn by [c], and
     * [k] times slower while the brain is still generating (Mac: 330 vs 1,136 ms => k ~3.4).
     */
    private fun simulate(t: Turn, make: () -> SentenceChunker, k: Double, cFixed: Double? = null): Triple<Double, Double, Double> {
        val text = t.reply.replace(Regex("""\[[^\]]*\]"""), "").replace("*", "").trim()
        if (text.isEmpty() || t.tokens == 0) return Triple(0.0, 0.0, 0.0)
        val msPerChar = 1000.0 / (t.tokS * text.length.toDouble() / t.tokens)
        val genEnd = t.ftMs + text.length * msPerChar
        val audioPerChar = t.audioMs / text.length
        val c = make(); val ready = mutableListOf<Pair<String, Double>>()
        var pos = 0
        for (piece in text.chunked(4)) { pos += piece.length; c.push(piece).forEach { ready += it to (t.ftMs + pos * msPerChar) } }
        c.flush()?.let { ready += it to genEnd }
        fun run(scale: Double): Triple<Double, Double, Double> {
            var synthEnd = 0.0; var playEnd = 0.0; var first = -1.0; var silence = 0.0; var synthSum = 0.0
            for ((chunk, at) in ready) {
                val start = maxOf(at, synthEnd)
                val alone = scale * (260.0 + 2.6 * chunk.length)
                // Contended for the part of synthesis that overlaps generation.
                val contended = if (start < genEnd) minOf(alone * k, (genEnd - start) + (alone - (genEnd - start) / k).coerceAtLeast(0.0)) else alone
                synthEnd = start + contended; synthSum += contended
                val play = maxOf(synthEnd, playEnd)
                if (first < 0) first = play else silence += play - playEnd
                playEnd = play + audioPerChar * chunk.length
            }
            return Triple(first, silence, synthSum)
        }
        if (cFixed != null) return run(cFixed)
        // Fit the per-turn speed so the simulated total synth equals the phone's (bisection).
        var lo = 0.05; var hi = 20.0
        repeat(40) { val mid = (lo + hi) / 2; if (run(mid).third < t.synthTotal) lo = mid else hi = mid }
        return run((lo + hi) / 2).let { Triple(it.first, it.second, (lo + hi) / 2) }
    }

    @Test fun replay() {
        val dir = System.getenv("CHUNK_SIM_LOGS"); assumeTrue(dir != null)
        val turns = parse(File(dir!!)).filter { it.chunks > 1 }
        fun med(x: List<Double>) = x.sorted()[x.size / 2]
        println("turns: ${turns.size}; phone: first audio ${med(turns.map { it.obsFirstAudio })} ms, silence ${med(turns.map { it.obsSilence })} ms")
        for (k in listOf(1.0, 2.0, 3.0, 3.4, 4.0)) {
            val sim = turns.map { simulate(it, { SentenceChunker() }, k) }
            val err = turns.indices.map { kotlin.math.abs(sim[it].second - turns[it].obsSilence) }
            println("k=$k: sim first audio ${med(sim.map { it.first }).toInt()} ms, silence ${med(sim.map { it.second }).toInt()} ms, median |silence error| ${med(err).toInt()} ms")
        }
        val k = (System.getenv("CHUNK_SIM_K") ?: "3.4").toDouble()
        val policies = linkedMapOf<String, () -> SentenceChunker>(
            "current" to { SentenceChunker() },
            "ramp 1" to { SentenceChunker(rampChunks = 1) },
            "ramp 2" to { SentenceChunker(rampChunks = 2) },
            "ramp 3" to { SentenceChunker(rampChunks = 3) },
        )
        for ((hot, label) in listOf(false to "cool (status 0-2)", true to "hot (status 3-4)")) {
            val ts = turns.filter { (it.heat >= 3) == hot }
            // Each turn keeps the speed fitted under the current chunker, so policies compare like for like.
            val scale = ts.map { simulate(it, { SentenceChunker() }, k).third }
            for ((name, mk) in policies) {
                val r = ts.indices.map { simulate(ts[it], mk, k, scale[it]) }
                println("k=$k $label n=${ts.size} | $name: first audio ${med(r.map { it.first }).toInt()} ms, silence median ${med(r.map { it.second }).toInt()} ms, p75 ${r.map { it.second }.sorted()[3 * r.size / 4].toInt()} ms")
            }
        }
    }
}
