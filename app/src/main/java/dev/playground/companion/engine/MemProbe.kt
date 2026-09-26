package dev.playground.companion.engine

import android.app.ActivityManager
import android.content.Context
import java.io.File

/** Cheap memory readings. RSS includes mmap'd model pages that are resident. */
object MemProbe {
    data class Snapshot(val rssMb: Long, val peakRssMb: Long, val availMb: Long, val totalMb: Long, val lowMemory: Boolean)

    fun read(ctx: Context): Snapshot {
        var rss = 0L; var hwm = 0L
        runCatching {
            File("/proc/self/status").forEachLine { line ->
                when {
                    line.startsWith("VmRSS:") -> rss = kb(line)
                    line.startsWith("VmHWM:") -> hwm = kb(line)
                }
            }
        }
        val mi = ActivityManager.MemoryInfo()
        (ctx.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager).getMemoryInfo(mi)
        return Snapshot(rss / 1024, hwm / 1024, mi.availMem shr 20, mi.totalMem shr 20, mi.lowMemory)
    }

    private fun kb(line: String) = line.filter { it.isDigit() }.toLongOrNull() ?: 0L
}
