package dev.playground.companion

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Color
import android.webkit.JavascriptInterface
import android.webkit.WebView
import android.webkit.WebViewClient
import java.util.Locale

/**
 * The character on screen: a WebView running the bundled three.js stage
 * (app/src/main/assets/avatar, built from web/avatar). Fully offline.
 * Calls made before the page is ready are queued and replayed.
 */
@SuppressLint("SetJavaScriptEnabled", "ViewConstructor")
class AvatarView(ctx: Context) : WebView(ctx) {
    private var ready = false
    private val pending = mutableListOf<String>()
    var state = "idle"; private set

    init {
        setBackgroundColor(Color.rgb(5, 5, 10))
        settings.javaScriptEnabled = true
        settings.allowFileAccess = false // file:///android_asset stays readable regardless
        webViewClient = WebViewClient()
        addJavascriptInterface(Bridge(), "AndroidAvatar")
        loadUrl("file:///android_asset/avatar/index.html")
    }

    private inner class Bridge {
        @JavascriptInterface
        fun onReady() = post {
            ready = true
            pending.forEach { evaluateJavascript(it, null) }
            pending.clear()
        }
    }

    private fun js(code: String) = post { if (ready) evaluateJavascript(code, null) else pending += code }

    fun setCharacter(id: String) = js("avatar.setCharacter('$id')")

    /** idle | listening | thinking | speaking */
    fun setState(s: String) {
        post { state = s }
        js("avatar.setState('$s')")
    }

    /** Lip-sync one audio chunk that starts playing now; [delayMs] covers output latency. */
    fun speak(envelope: FloatArray, frameMs: Int, delayMs: Int) {
        val arr = envelope.joinToString(",", "[", "]") { String.format(Locale.US, "%.2f", it) }
        post { state = "speaking" }
        js("avatar.speak($arr,$frameMs,$delayMs)")
    }

    fun stopSpeaking() = js("avatar.stopSpeaking()")

    /** calm | happy | sad | angry | surprised | curious | tender */
    fun setEmotion(tag: String) = js("avatar.setEmotion('$tag')")

    fun flinch() = js("avatar.flinch()")

    fun pauseRendering() { js("avatar.pause()"); onPause() }

    fun resumeRendering() { onResume(); js("avatar.resume()") }
}
