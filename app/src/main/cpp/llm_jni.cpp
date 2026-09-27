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
// [promptTokens, prefillMs, genTokens, genMs, rebuilt, cancelled].
JNIEXPORT jdoubleArray JNICALL
Java_dev_playground_companion_engine_NativeLlm_reply(JNIEnv * env, jobject, jstring user, jint max_tokens, jstring prefix, jobject sink) {
    jclass    cls       = env->GetObjectClass(sink);
    jmethodID on_piece  = env->GetMethodID(cls, "onPiece", "([B)Z");

    LlmTurnStats st;
    g_engine.reply(to_std(env, user), max_tokens, [&](const std::string & piece) {
        // Bytes, not NewStringUTF: JNI's modified UTF-8 mangles emoji and other 4-byte chars.
        jbyteArray arr = env->NewByteArray((jsize) piece.size());
        env->SetByteArrayRegion(arr, 0, (jsize) piece.size(), reinterpret_cast<const jbyte *>(piece.data()));
        const jboolean keep = env->CallBooleanMethod(sink, on_piece, arr);
        env->DeleteLocalRef(arr);
        if (env->ExceptionCheck()) { env->ExceptionClear(); return false; }
        return keep == JNI_TRUE;
    }, st, to_std(env, prefix));

    const jdouble vals[6] = { (double) st.prompt_tokens, st.prefill_ms, (double) st.gen_tokens, st.gen_ms,
                              st.rebuilt ? 1.0 : 0.0, st.cancelled ? 1.0 : 0.0 };
    jdoubleArray out = env->NewDoubleArray(6);
    env->SetDoubleArrayRegion(out, 0, 6, vals);
    return out;
}

JNIEXPORT void JNICALL
Java_dev_playground_companion_engine_NativeLlm_cancel(JNIEnv *, jobject) { g_engine.cancel(); }

JNIEXPORT void JNICALL
Java_dev_playground_companion_engine_NativeLlm_unload(JNIEnv *, jobject) { g_engine.unload(); }

JNIEXPORT jstring JNICALL
Java_dev_playground_companion_engine_NativeLlm_systemInfo(JNIEnv * env, jobject) {
    return env->NewStringUTF(g_engine.system_info().c_str());
}

} // extern "C"
