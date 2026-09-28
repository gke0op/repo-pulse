// JNI bridge: dev.playground.companion.engine.NativeLlm <-> LlmEngine.
#include <android/log.h>
#include <jni.h>

#include <string>

#include "llm_engine.h"

#define TAG "companion-llm"

static LlmEngine g_engine;

static std::string to_std(JNIEnv * env, jstring s) {
    const char * c = env->GetStringUTFChars(s, nullptr);
    std::string out(c);
    env->ReleaseStringUTFChars(s, c);
    return out;
}

extern "C" {

JNIEXPORT void JNICALL
Java_dev_playground_companion_engine_NativeLlm_init(JNIEnv * env, jobject, jstring native_lib_dir) {
    llama_log_set([](ggml_log_level level, const char * text, void *) {
        if (level >= GGML_LOG_LEVEL_WARN) __android_log_print(ANDROID_LOG_WARN, TAG, "%s", text);
    }, nullptr);
    // Loads the best CPU variant for this chip (dotprod / i8mm / sve ...).
    ggml_backend_load_all_from_path(to_std(env, native_lib_dir).c_str());
    llama_backend_init();
}

JNIEXPORT jboolean JNICALL
Java_dev_playground_companion_engine_NativeLlm_load(JNIEnv * env, jobject, jstring path, jint n_ctx, jint n_threads, jint n_threads_batch) {
    return g_engine.load(to_std(env, path), n_ctx, n_threads, n_threads_batch);
}

JNIEXPORT jboolean JNICALL
Java_dev_playground_companion_engine_NativeLlm_setSystem(JNIEnv * env, jobject, jstring prompt) {
    return g_engine.set_system(to_std(env, prompt));
}

// Streams UTF-8 pieces to sink.onPiece(byte[]): Boolean. Returns
// [promptTokens, prefillMs, genTokens, genMs, rebuilt, cancelled, shiftReused, replyId].
JNIEXPORT jdoubleArray JNICALL
Java_dev_playground_companion_engine_NativeLlm_reply(JNIEnv * env, jobject, jstring user, jint max_tokens, jstring prefix, jobject sink) {
    jclass    cls       = env->GetObjectClass(sink);
    jmethodID on_piece  = env->GetMethodID(cls, "onPiece", "([B)Z");

    LlmTurnStats st;
    // A C++ exception (e.g. a chat template raising) must not cross JNI: that aborts the app.
    try {
    g_engine.reply(to_std(env, user), max_tokens, [&](const std::string & piece) {
        // Bytes, not NewStringUTF: JNI's modified UTF-8 mangles emoji and other 4-byte chars.
        jbyteArray arr = env->NewByteArray((jsize) piece.size());
        env->SetByteArrayRegion(arr, 0, (jsize) piece.size(), reinterpret_cast<const jbyte *>(piece.data()));
        const jboolean keep = env->CallBooleanMethod(sink, on_piece, arr);
        env->DeleteLocalRef(arr);
        if (env->ExceptionCheck()) { env->ExceptionClear(); return false; }
        return keep == JNI_TRUE;
    }, st, to_std(env, prefix));
    } catch (const std::exception & e) {
        __android_log_print(ANDROID_LOG_ERROR, TAG, "reply failed: %s", e.what());
    }

    const jdouble vals[8] = { (double) st.prompt_tokens, st.prefill_ms, (double) st.gen_tokens, st.gen_ms,
                              st.rebuilt ? 1.0 : 0.0, st.cancelled ? 1.0 : 0.0, (double) st.shift_reused, (double) st.reply_id };
    jdoubleArray out = env->NewDoubleArray(8);
    env->SetDoubleArrayRegion(out, 0, 8, vals);
    return out;
}

JNIEXPORT void JNICALL
Java_dev_playground_companion_engine_NativeLlm_cancel(JNIEnv *, jobject) { g_engine.cancel(); }

// UTF-8 bytes (decoded in Kotlin, like reply()): NewStringUTF needs *modified* UTF-8 and aborts on
// anything else under CheckJNI. Null = failed or cancelled.
JNIEXPORT jbyteArray JNICALL
Java_dev_playground_companion_engine_NativeLlm_completeIsolatedBytes(JNIEnv * env, jobject, jstring system, jstring user, jint max_tokens, jint n_ctx) {
    std::string out;
    bool ok = false;
    try { ok = g_engine.complete_isolated(to_std(env, system), to_std(env, user), max_tokens, n_ctx, out); }
    catch (const std::exception & e) { __android_log_print(ANDROID_LOG_ERROR, TAG, "complete failed: %s", e.what()); }
    if (!ok) return nullptr;
    jbyteArray arr = env->NewByteArray((jsize) out.size());
    env->SetByteArrayRegion(arr, 0, (jsize) out.size(), reinterpret_cast<const jbyte *>(out.data()));
    return arr;
}

JNIEXPORT void JNICALL
Java_dev_playground_companion_engine_NativeLlm_hold(JNIEnv *, jobject, jboolean on) { g_engine.hold(on == JNI_TRUE); }

JNIEXPORT void JNICALL
Java_dev_playground_companion_engine_NativeLlm_retractLastReply(JNIEnv *, jobject, jlong reply_id, jboolean drop_user) {
    g_engine.retract_last_reply(reply_id, drop_user == JNI_TRUE);
}

JNIEXPORT void JNICALL
Java_dev_playground_companion_engine_NativeLlm_unload(JNIEnv *, jobject) { g_engine.unload(); }

JNIEXPORT jstring JNICALL
Java_dev_playground_companion_engine_NativeLlm_systemInfo(JNIEnv * env, jobject) {
    return env->NewStringUTF(g_engine.system_info().c_str());
}

} // extern "C"
