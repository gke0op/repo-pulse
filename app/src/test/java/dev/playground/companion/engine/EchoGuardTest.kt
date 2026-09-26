package dev.playground.companion.engine

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class EchoGuardTest {
    private val said = "Honestly, I think the rain makes everything feel a little softer, don't you?"

    @Test fun herOwnWordsAreEcho() = assertTrue(EchoGuard.isEcho("the rain makes everything feel", said))

    @Test fun asrStyleLowercaseEchoIsCaught() = assertTrue(EchoGuard.isEcho("i think the rain makes", said))

    @Test fun userSentenceIsNotEcho() = assertFalse(EchoGuard.isEcho("what do you want for dinner tonight", said))

    @Test fun shortRepliesNeverCountAsEcho() = assertFalse(EchoGuard.isEcho("don't you", said))

    @Test fun partialOverlapBelowThresholdIsUser() = assertFalse(EchoGuard.isEcho("i hate rain so much honestly wow", said))
}

class SentenceCaseTest {
    @Test fun capsBecomeSentenceCase() =
        org.junit.Assert.assertEquals("Honestly I think I'm tired", Ears.sentenceCase("HONESTLY I THINK I'M TIRED"))
}
