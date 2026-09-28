// Smart Turn v3 (pipecat-ai, BSD-2): "has the user finished their turn?" from the last 8 s of audio.
// Plain C++ over the ONNX Runtime C API (the libonnxruntime.so sherpa-onnx already ships), so it
// builds on the desktop too (tools/host-test/turn_eval) and is checked against the Python reference.
#pragma once

#include <string>
#include <vector>

struct OrtApi;
struct OrtEnv;
struct OrtSession;
struct OrtSessionOptions;
struct OrtMemoryInfo;

class SmartTurn {
public:
    static constexpr int kSampleRate = 16000;
    static constexpr int kSamples    = 8 * kSampleRate; // model window
    static constexpr int kMels       = 80;
    static constexpr int kFrames     = 800;

    ~SmartTurn();

    // model: smart-turn-v3.x-cpu.onnx; mel_filters: 201x80 float32, row-major (Whisper's, exported
    // from transformers' WhisperFeatureExtractor so the features match the reference exactly).
    bool load(const std::string & model, const std::string & mel_filters, int threads = 1);
    bool loaded() const { return session_ != nullptr; }

    // Probability (0..1) that the turn is complete, for 16 kHz mono audio ending now. -1 on error.
    float predict(const float * audio, int n);

    // Whisper log-mel features exactly as the reference computes them: [kMels][kFrames].
    void features(const float * audio, int n, std::vector<float> & out) const;

private:
    const OrtApi *      api_     = nullptr;
    OrtEnv *            env_     = nullptr;
    OrtSessionOptions * opts_    = nullptr;
    OrtSession *        session_ = nullptr;
    OrtMemoryInfo *     mem_     = nullptr;
    std::vector<float>  mel_;      // [201][80]
    std::vector<float>  window_;   // periodic Hann, 400
    std::vector<float>  cos_, sin_; // DFT tables [201][400]
};
