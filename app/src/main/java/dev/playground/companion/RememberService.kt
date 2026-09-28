package dev.playground.companion

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.IBinder
import android.util.Log

/**
 * Holds the app in the foreground while the characters distill their memories after you leave.
 * Without it the work ran in the background cpuset (S24 Ultra: cores 0-1,5-6 of 0-7) and a 6000-char
 * chunk took ~3.5 min, and Android killed the 3 GB process long before it finished: no distillation
 * ever completed on 2026-09-28. The service does no work itself; [Pipeline.remember] does.
 */
class RememberService : Service() {
    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val nm = getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(NotificationChannel(CHANNEL, "Remembering", NotificationManager.IMPORTANCE_LOW))
        val n = Notification.Builder(this, CHANNEL)
            .setSmallIcon(android.R.drawable.ic_popup_sync)
            .setContentTitle("Remembering today's conversation…")
            .setOngoing(true)
            .build()
        try {
            startForeground(ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
        } catch (e: Exception) {
            Log.w("companion", "remember service not in foreground: $e"); stopSelf(); return START_NOT_STICKY
        }
        // Stopping before startForeground() crashes the app, so a stop that came early waits for here.
        // By start id: a newer start still on its way keeps the service (review 2026-09-29).
        running = this; lastStartId = startId
        if (holds == 0) stopSelf(startId)
        return START_NOT_STICKY
    }

    /** Android 15's dataSync budget ran out (only if a hold leaked: remembering takes minutes). */
    override fun onTimeout(startId: Int, fgsType: Int) { stopSelf() }

    override fun onDestroy() { running = null; super.onDestroy() }

    companion object {
        private const val CHANNEL = "remember"
        private const val ID = 7

        // Main thread only (start, stop and onStartCommand all run there).
        private var running: RememberService? = null
        private var lastStartId = 0
        /** remember() runs queued, one per leave: the service stays while any of them is unfinished. */
        private var holds = 0

        /** False if Android refused (e.g. already in the background); remembering then runs slow but still runs. */
        fun start(ctx: Context): Boolean {
            holds++
            return try {
                ctx.startForegroundService(Intent(ctx, RememberService::class.java)); true
            } catch (e: Exception) {
                Log.w("companion", "remember service refused: $e"); false
            }
        }

        /** Once per [start], when that remember() is done (finished or paused). */
        fun stop() { if (holds > 0) holds--; if (holds == 0) running?.stopSelf(lastStartId) }
    }
}
