package dev.playground.companion

import dev.playground.companion.engine.Memory
import org.junit.Assume.assumeTrue
import org.junit.Test
import java.io.File

/**
 * Dev tool, skipped unless DUMP_PROMPTS_NOTES is set: writes each character's exact system prompt
 * with its notes (from <dir>/<id>.notes.txt, e.g. pulled from the phone) to build/prompts/<id>.txt,
 * for tools/host-test/recall_eval.
 */
class DumpPromptsTest {
    @Test fun dump() {
        val dir = System.getenv("DUMP_PROMPTS_NOTES")
        assumeTrue(dir != null)
        val out = File(System.getenv("DUMP_PROMPTS_OUT") ?: "build/prompts").apply { mkdirs() }
        for (c in CHARACTERS) {
            val notes = File(dir, "${c.id}.notes.txt").takeIf { it.exists() }?.let { Memory.parse(it.readText()) }.orEmpty()
            File(out, "${c.id}.txt").writeText(c.systemPrompt(Memory.promptBlock(notes)))
            File(out, "${c.id}.nomemory.txt").writeText(c.systemPrompt())
        }
    }
}
