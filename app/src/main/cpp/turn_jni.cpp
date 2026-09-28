// JNI for SmartTurn: dev.playground.companion.engine.TurnDetector.
#include <android/log.h>
#include <jni.h>

#include <memory>
#include <string>

#include "smart_turn.h"

#define TAG "companion-turn"

namespace {
std::unique_ptr<SmartTurn> g_turn;

std::string to_std(JNIEnv * env, jstring s) {
    const char * c = env->GetStringUTFChars(s, nullptr);
    std::string out(c);
    env->ReleaseStringUTFChars(s, c);
    return out;
}
} // namespace

extern "C" {

JNIEXPORT jboolean JNICALL
Java_dev_playground_companion_engine_TurnDetector_load(JNIEnv * env, jobject, jstring model, jstring mel) {
    auto t = std::make_unique<SmartTurn>();
    if (!t->load(to_std(env, model), to_std(env, mel), 1)) {
        __android_log_print(ANDROID_LOG_ERROR, TAG, "smart turn failed to load");
        return JNI_FALSE;
    }
    g_turn = std::move(t);
    return JNI_TRUE;
}

// Probability (0..1) that the turn is complete for 16 kHz audio ending now; -1 if not loaded.
JNIEXPORT jfloat JNICALL
Java_dev_playground_companion_engine_TurnDetector_predict(JNIEnv * env, jobject, jfloatArray audio) {
    if (!g_turn) return -1.f;
    const jsize n = env->GetArrayLength(audio);
    jfloat * a = env->GetFloatArrayElements(audio, nullptr);
    const float p = g_turn->predict(a, n);
    env->ReleaseFloatArrayElements(audio, a, JNI_ABORT);
    return p;
}

} // extern "C"
