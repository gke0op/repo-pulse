package dev.playground.companion

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Color
import android.webkit.JavascriptInterface
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
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
        webViewClient = AssetClient()
        addJavascriptInterface(Bridge(), "AndroidAvatar")
        loadUrl("https://$ASSET_HOST/avatar/index.html")
    }

    /** Serves app assets on a private https origin so the page can fetch() its .vrm models (file:// can't). */
    private inner class AssetClient : WebViewClient() {
        override fun shouldInterceptRequest(view: WebView, req: WebResourceRequest): WebResourceResponse? {
            val url = req.url
            if (url.host != ASSET_HOST) return null
            val path = url.path?.trimStart('/') ?: return null
            val mime = when (path.substringAfterLast('.')) {
                "html" -> "text/html"; "js" -> "text/javascript"; "vrm" -> "model/gltf-binary"
                else -> "application/octet-stream"
            }
            return try {
                WebResourceResponse(mime, "utf-8", context.assets.open(path))
            } catch (e: java.io.IOException) {
                WebResourceResponse("text/plain", "utf-8", 404, "Not Found", null, null)
            }
        }
    }

    private companion object { const val ASSET_HOST = "appassets.androidplatform.net" }

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

    /** Emotion intensity profile for the human avatars: "A" (subtle) or "B" (louder). */
    fun setProfile(p: String) = js("avatar.setProfile('$p')")

    fun pauseRendering() { js("avatar.pause()"); onPause() }

    fun resumeRendering() { onResume(); js("avatar.resume()") }
}
