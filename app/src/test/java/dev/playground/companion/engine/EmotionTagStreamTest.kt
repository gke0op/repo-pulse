package dev.playground.companion.engine

import dev.playground.companion.engine.EmotionTagStream.Part
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class EmotionTagStreamTest {
    private fun run(vararg pieces: String): Pair<String, List<Emotion?>> {
        val s = EmotionTagStream()
        val text = StringBuilder()
        val tags = mutableListOf<Emotion?>()
        for (p in pieces) for (part in s.push(p)) when (part) {
            is Part.Text -> text.append(part.text)
            is Part.Tag -> tags += part.emotion
        }
        s.flush()?.let { text.append(it) }
        return text.toString() to tags
    }

    @Test fun tagSplitAcrossPieces() =
        assertEquals(" Oh wow!" to listOf(Emotion.HAPPY), run("[Hap", "py] Oh", " wow!"))

    @Test fun midReplyTagSwitchesEmotion() =
        assertEquals("Great. Wait, really?" to listOf(Emotion.HAPPY, Emotion.SURPRISED),
            run("[happy]Great. [Surprised]Wait, really?"))

    @Test fun synonymsMapOntoOurSeven() =
        assertEquals(listOf(Emotion.TENDER, Emotion.ANGRY, Emotion.CALM), run("[Sympathetic] a [Defensive] b [Relieved] c").second)

    @Test fun unknownTagIsSilentButNotSpoken() {
        val (text, tags) = run("[Wistful] I see.")
        assertEquals(" I see.", text)
        assertEquals(1, tags.size)
        assertNull(tags[0])
    }

    @Test fun bracketsThatAreNotTagsAreKept() {
        assertEquals("Item [1] and [see: notes]", run("Item [1] and [see: notes]").first)
    }

    @Test fun unterminatedBracketIsFlushedAsText() = assertEquals("Hmm [maybe", run("Hmm [maybe").first)
}
