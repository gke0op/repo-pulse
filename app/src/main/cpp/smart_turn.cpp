#include "smart_turn.h"

#include <algorithm>
#include <cmath>
#include <fstream>

#include "onnxruntime_c_api.h"

namespace {
constexpr int kFft  = 400;           // Whisper n_fft
constexpr int kHop  = 160;           // Whisper hop
constexpr int kBins = kFft / 2 + 1;  // 201
}

SmartTurn::~SmartTurn() {
    if (!api_) return;
    if (session_) api_->ReleaseSession(session_);
    if (opts_) api_->ReleaseSessionOptions(opts_);
    if (mem_) api_->ReleaseMemoryInfo(mem_);
    if (env_) api_->ReleaseEnv(env_);
}

bool SmartTurn::load(const std::string & model, const std::string & mel_filters, int threads) {
    std::ifstream f(mel_filters, std::ios::binary);
    mel_.assign(kBins * kMels, 0.f);
    if (!f.read(reinterpret_cast<char *>(mel_.data()), (std::streamsize) (mel_.size() * sizeof(float)))) return false;

    window_.resize(kFft);
    for (int i = 0; i < kFft; ++i) window_[i] = 0.5f - 0.5f * std::cos(2.0 * M_PI * i / kFft); // periodic
    cos_.resize(kBins * kFft);
    sin_.resize(kBins * kFft);
    for (int k = 0; k < kBins; ++k)
        for (int n = 0; n < kFft; ++n) {
            const double a = 2.0 * M_PI * (double) ((long) k * n % kFft) / kFft;
            cos_[k * kFft + n] = (float) std::cos(a);
            sin_[k * kFft + n] = (float) std::sin(a);
        }

    api_ = OrtGetApiBase()->GetApi(ORT_API_VERSION);
    if (!api_) return false;
    if (api_->CreateEnv(ORT_LOGGING_LEVEL_WARNING, "smart-turn", &env_)) return false;
    if (api_->CreateSessionOptions(&opts_)) return false;
    api_->SetIntraOpNumThreads(opts_, threads);
    api_->SetInterOpNumThreads(opts_, 1);
    if (api_->CreateSession(env_, model.c_str(), opts_, &session_)) { session_ = nullptr; return false; }
    if (api_->CreateCpuMemoryInfo(OrtArenaAllocator, OrtMemTypeDefault, &mem_)) return false;
    return true;
}

void SmartTurn::features(const float * audio, int n, std::vector<float> & out) const {
    // Last 8 s, zero-padded at the front (audio_utils.truncate_audio_to_last_n_seconds).
    std::vector<float> x(kSamples, 0.f);
    const int take = std::min(n, kSamples);
    std::copy(audio + n - take, audio + n, x.begin() + (kSamples - take));
    // do_normalize: zero mean, unit variance over the whole window.
    double mean = 0, var = 0;
    for (float v : x) mean += v;
    mean /= kSamples;
    for (float v : x) var += (v - mean) * (v - mean);
    var /= kSamples;
    const float inv = (float) (1.0 / std::sqrt(var + 1e-7));
    for (float & v : x) v = (float) ((v - mean) * inv);
    // center=True, reflect padding of n_fft/2 on both sides.
    const int pad = kFft / 2;
    std::vector<float> p(kSamples + 2 * pad);
    for (int i = 0; i < pad; ++i) {
        p[pad - 1 - i] = x[i + 1];
        p[pad + kSamples + i] = x[kSamples - 2 - i];
    }
    std::copy(x.begin(), x.end(), p.begin() + pad);
    // Power spectrum -> mel -> log10, for frames 0..kFrames-1 (the reference drops the 801st).
    out.assign(kMels * kFrames, 0.f);
    std::vector<float> frame(kFft), power(kBins);
    float maxv = -1e30f;
    for (int t = 0; t < kFrames; ++t) {
        const float * s = p.data() + t * kHop;
        for (int i = 0; i < kFft; ++i) frame[i] = s[i] * window_[i];
        for (int k = 0; k < kBins; ++k) {
            const float * c = cos_.data() + k * kFft;
            const float * si = sin_.data() + k * kFft;
            float re = 0, im = 0;
            for (int i = 0; i < kFft; ++i) { re += frame[i] * c[i]; im += frame[i] * si[i]; }
            power[k] = re * re + im * im;
        }
        for (int m = 0; m < kMels; ++m) {
            float e = 0;
            for (int k = 0; k < kBins; ++k) e += mel_[k * kMels + m] * power[k];
            const float l = std::log10(std::max(e, 1e-10f));
            out[m * kFrames + t] = l;
            maxv = std::max(maxv, l);
        }
    }
    for (float & v : out) v = (std::max(v, maxv - 8.0f) + 4.0f) / 4.0f;
}

float SmartTurn::predict(const float * audio, int n) {
    if (!session_) return -1.f;
    std::vector<float> feat;
    features(audio, n, feat);
    const int64_t shape[3] = {1, kMels, kFrames};
    OrtValue * in = nullptr;
    OrtValue * out = nullptr;
    if (api_->CreateTensorWithDataAsOrtValue(mem_, feat.data(), feat.size() * sizeof(float), shape, 3,
                                             ONNX_TENSOR_ELEMENT_DATA_TYPE_FLOAT, &in)) return -1.f;
    const char * in_names[] = {"input_features"};
    const char * out_names[] = {"logits"}; // already a sigmoid probability, per the reference
    float prob = -1.f;
    if (!api_->Run(session_, nullptr, in_names, &in, 1, out_names, 1, &out)) {
        float * data = nullptr;
        if (!api_->GetTensorMutableData(out, reinterpret_cast<void **>(&data)) && data) prob = data[0];
    }
    if (out) api_->ReleaseValue(out);
    api_->ReleaseValue(in);
    return prob;
}
