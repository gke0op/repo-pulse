package dev.playground.companion.engine

import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioTrack
import java.util.concurrent.LinkedBlockingQueue

/**
 * Gapless streaming player. Chunks are queued and written on a dedicated thread;
 * [flush] drops everything instantly (the hook barge-in will use).
 */
class AudioOut(private val sampleRate: Int) {
    private class Item(val samples: FloatArray, val onStart: (() -> Unit)?, val onEnd: (() -> Unit)?)

    private val queue = LinkedBlockingQueue<Item>()
    @Volatile private var generation = 0

    private val track = AudioTrack.Builder()
        .setAudioAttributes(
            AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_MEDIA)
                .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                .build(),
        )
        .setAudioFormat(
            AudioFormat.Builder()
                .setEncoding(AudioFormat.ENCODING_PCM_FLOAT)
                .setSampleRate(sampleRate)
                .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                .build(),
        )
        .setBufferSizeInBytes(
            AudioTrack.getMinBufferSize(sampleRate, AudioFormat.CHANNEL_OUT_MONO, AudioFormat.ENCODING_PCM_FLOAT) * 2,
        )
        .setTransferMode(AudioTrack.MODE_STREAM)
        .build()

    private val thread = Thread({
        track.play()
        while (true) {
            val item = try { queue.take() } catch (_: InterruptedException) { break }
            val gen = generation
            item.onStart?.invoke()
            var off = 0
            while (off < item.samples.size && gen == generation) {
                val n = minOf(2048, item.samples.size - off)
                val w = track.write(item.samples, off, n, AudioTrack.WRITE_BLOCKING)
                if (w <= 0) break
                off += w
            }
            if (gen == generation) item.onEnd?.invoke()
        }
    }, "audio-out").apply { isDaemon = true; start() }

    fun enqueue(samples: FloatArray, onStart: (() -> Unit)? = null, onEnd: (() -> Unit)? = null) {
        queue.put(Item(samples, onStart, onEnd))
    }

    /** Signals the end of a turn once everything queued before it has played. */
    fun marker(onReached: () -> Unit) = enqueue(FloatArray(0), onStart = onReached)

    fun flush() {
        generation++
        queue.clear()
        track.pause()
        track.flush()
        track.play()
    }

    fun release() {
        thread.interrupt()
        track.release()
    }
}
